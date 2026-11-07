"""Local accounts + saved reports. Everything lives on this machine under accounts/ (git-ignored, NOT under the
statically served cache/ folder).

- Passwords: PBKDF2-HMAC-SHA256, 240k iterations, per-user random salt. Never stored or logged in plain text.
- Sessions: random 32-byte bearer tokens (hashed at rest), 30-day expiry.
- Reports: one JSON bundle per saved report, scoped to its owner.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from scan import CACHE

ROOT = Path(__file__).resolve().parent.parent / "accounts"
USERS = ROOT / "users.json"
SESSIONS = ROOT / "sessions.json"
ITER = 240_000
TTL = 30 * 24 * 3600
_lock = threading.Lock()
router = APIRouter(prefix="/api")


def _read(p: Path) -> dict:
    return json.loads(p.read_text()) if p.exists() else {}


def _write(p: Path, d: dict) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d))
    tmp.replace(p)


def _hash_pw(pw: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITER).hex()


def _tok_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    with _lock:
        s = _read(SESSIONS)
        now = time.time()
        s = {k: v for k, v in s.items() if v["exp"] > now}  # prune expired
        s[_tok_key(token)] = {"user": username, "exp": now + TTL}
        _write(SESSIONS, s)
    return token


def current_user(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to continue.")
    tok = authorization.split(" ", 1)[1].strip()
    sess = _read(SESSIONS).get(_tok_key(tok))
    if not sess or sess["exp"] < time.time():
        raise HTTPException(401, "Your session expired. Sign in again.")
    u = _read(USERS).get(sess["user"])
    if not u:
        raise HTTPException(401, "Account not found.")
    return {"username": sess["user"], "name": u.get("name") or sess["user"], "created": u.get("created")}


def _public(u: dict) -> dict:
    return {"username": u["username"], "name": u["name"]}


class Creds(BaseModel):
    username: str
    password: str
    name: str | None = None


@router.post("/auth/register")
def register(c: Creds):
    un = c.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,32}", un):
        raise HTTPException(400, "Username: 3–32 letters, numbers, dots, dashes or underscores.")
    if len(c.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    with _lock:
        users = _read(USERS)
        if un in users:
            raise HTTPException(409, "That username is taken.")
        salt = secrets.token_bytes(16)
        users[un] = {"salt": salt.hex(), "hash": _hash_pw(c.password, salt), "name": (c.name or "").strip()[:60] or un, "created": int(time.time())}
        _write(USERS, users)
    return {"token": _new_session(un), "user": {"username": un, "name": users[un]["name"]}}


@router.post("/auth/login")
def login(c: Creds):
    un = c.username.strip().lower()
    u = _read(USERS).get(un)
    # compare in constant time; do the work even for unknown users so timing doesn't leak which usernames exist
    salt = bytes.fromhex(u["salt"]) if u else b"\x00" * 16
    ok = hmac.compare_digest(_hash_pw(c.password, salt), u["hash"] if u else "0" * 64)
    if not (u and ok):
        raise HTTPException(401, "Wrong username or password.")
    return {"token": _new_session(un), "user": {"username": un, "name": u["name"]}}


@router.post("/auth/logout")
def logout(authorization: str | None = Header(None)):
    if authorization and authorization.lower().startswith("bearer "):
        with _lock:
            s = _read(SESSIONS)
            s.pop(_tok_key(authorization.split(" ", 1)[1].strip()), None)
            _write(SESSIONS, s)
    return {"ok": True}


@router.get("/auth/me")
def me(authorization: str | None = Header(None)):
    return _public(current_user(authorization))


# ------------------------------------------------------------------ saved reports
def _dir(username: str) -> Path:
    d = ROOT / "reports" / username
    d.mkdir(parents=True, exist_ok=True)
    return d


SNAPSHOT_FILES = ["meshes", "slices", "manifest.json", "report.json", "explain.json", "events.jsonl", "wsp_events.jsonl",
                  "lesion_net_edited.pt", "ct.nii.gz", "seg_fast.nii.gz"]


class SaveReq(BaseModel):
    scanId: str
    title: str | None = None
    shots: list[dict[str, Any]] = []
    thumb: str | None = None


@router.post("/me/reports")
def save_report(body: SaveReq, authorization: str | None = Header(None)):
    u = current_user(authorization)
    sdir = CACHE / body.scanId
    rp = sdir / "report.json"
    if not rp.exists():
        raise HTTPException(404, "Generate the report before saving it.")
    rep = json.loads(rp.read_text())
    man = json.loads((sdir / "manifest.json").read_text()) if (sdir / "manifest.json").exists() else {}
    ex = json.loads((sdir / "explain.json").read_text()) if (sdir / "explain.json").exists() else None
    wsp_events = []
    wp = sdir / "wsp_events.jsonl"
    if wp.exists():
        wsp_events = [json.loads(l) for l in wp.read_text().splitlines() if l.strip()]
    rid = uuid.uuid4().hex[:10]
    bundle = {
        "id": rid, "owner": u["username"], "saved": int(time.time()), "scanId": body.scanId,
        "title": (body.title or rep.get("title") or "CT report").strip()[:80],
        "report": rep, "manifest": man, "explain": ex, "wspEvents": wsp_events,
        "shots": body.shots[:12], "thumb": body.thumb,
    }
    events = []
    ep = sdir / "events.jsonl"
    if ep.exists():
        events = [json.loads(l) for l in ep.read_text().splitlines() if l.strip()]
    bundle["events"] = events
    if len(json.dumps(bundle)) > 25_000_000:
        raise HTTPException(413, "Report is too large to save.")
    (_dir(u["username"]) / f"{rid}.json").write_text(json.dumps(bundle))
    # snapshot the scan's files so the report reopens even after the scan cache is cleared
    snap = _dir(u["username"]) / rid
    for name in SNAPSHOT_FILES:
        src = sdir / name
        if src.is_dir():
            shutil.copytree(src, snap / name, dirs_exist_ok=True)
        elif src.exists():
            snap.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, snap / name)
    for f in sdir.glob("lesion_*_features.npy"):
        shutil.copy2(f, snap / f.name)
    return {"id": rid, "title": bundle["title"], "saved": bundle["saved"]}


@router.get("/me/reports")
def list_reports(authorization: str | None = Header(None)):
    u = current_user(authorization)
    out = []
    for p in sorted(_dir(u["username"]).glob("*.json"), key=lambda p: -p.stat().st_mtime):
        b = json.loads(p.read_text())
        r = b.get("report", {})
        out.append({"id": b["id"], "title": b["title"], "saved": b["saved"], "scanId": b["scanId"], "thumb": b.get("thumb"),
                    "nOrgans": r.get("nOrgans"), "nFindings": len(r.get("findings") or []),
                    "impression": (r.get("opus") or {}).get("impression", "")[:220]})
    return out


def _owned(username: str, rid: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{10}", rid):
        raise HTTPException(404)
    p = _dir(username) / f"{rid}.json"
    if not p.exists():
        raise HTTPException(404, "Report not found.")
    return p


@router.get("/me/reports/{rid}")
def get_report(rid: str, authorization: str | None = Header(None)):
    u = current_user(authorization)
    b = json.loads(_owned(u["username"], rid).read_text())
    # bring the scan back into the working cache if it was cleared (meshes, slices, custom model…)
    snap = _dir(u["username"]) / rid
    sdir = CACHE / b["scanId"]
    restored = False
    if snap.exists():
        for item in snap.iterdir():
            dst = sdir / item.name
            if dst.exists():
                continue
            sdir.mkdir(parents=True, exist_ok=True)
            if item.is_dir():
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)
            restored = True
    b["restored"] = restored
    return b


@router.delete("/me/reports/{rid}")
def delete_report(rid: str, authorization: str | None = Header(None)):
    u = current_user(authorization)
    _owned(u["username"], rid).unlink()
    shutil.rmtree(_dir(u["username"]) / rid, ignore_errors=True)
    return {"ok": True}
