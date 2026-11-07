"""ask_model: lets Opus consult any OpenRouter model (second opinions, cheap translation, fallback)."""
from __future__ import annotations

import os

import httpx
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
URL = "https://openrouter.ai/api/v1/chat/completions"


async def ask_model(model: str, prompt: str, images_b64: list[str] | None = None, max_tokens: int = 900) -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        return "OpenRouter key missing (set OPENROUTER_API_KEY in .env)."
    content: list[dict] = [{"type": "text", "text": prompt}]
    for b in images_b64 or []:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b}"}})
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(
            URL,
            headers={"Authorization": f"Bearer {key}", "X-Title": "Lumen"},
            json={"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": max_tokens},
        )
    if r.status_code != 200:
        return f"OpenRouter error {r.status_code}: {r.text[:300]}"
    return r.json()["choices"][0]["message"]["content"] or ""
