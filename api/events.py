"""Per-job event log with async fan-out (SSE) and on-disk persistence for replay."""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, AsyncIterator


class EventLog:
    def __init__(self, path: Path | None = None):
        self.events: list[dict[str, Any]] = []
        self.done = False
        self._cond = asyncio.Condition()
        self.path = path
        self.t0 = time.time()
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("")

    def emit(self, type: str, **data: Any) -> dict[str, Any]:
        ev = {"i": len(self.events), "t": round(time.time() - self.t0, 2), "type": type, **data}
        self.events.append(ev)
        if self.path:
            with self.path.open("a") as f:
                f.write(json.dumps(ev, default=str) + "\n")
        self._notify()
        return ev

    def finish(self) -> None:
        self.done = True
        self._notify()

    def _notify(self) -> None:
        async def _n():
            async with self._cond:
                self._cond.notify_all()

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_n())
        except RuntimeError:
            pass

    async def stream(self, start: int = 0) -> AsyncIterator[dict[str, Any]]:
        i = start
        while True:
            while i < len(self.events):
                yield self.events[i]
                i += 1
            if self.done:
                return
            async with self._cond:
                try:
                    await asyncio.wait_for(self._cond.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass

    @classmethod
    def replay(cls, path: Path, speed: float = 6.0, cap: float = 0.7) -> "EventLog":
        """Re-emit a recorded run at `speed`x so rehearsals don't burn subscription usage."""
        log = cls()
        recorded = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]

        async def _run():
            last = 0.0
            for ev in recorded:
                await asyncio.sleep(0.04 if ev["type"] == "mesh" else max(0.0, min((ev["t"] - last) / speed, cap)))
                last = ev["t"]
                e = {k: v for k, v in ev.items() if k not in ("i", "t", "type")}
                log.emit(ev["type"], **e)
            log.finish()

        asyncio.get_running_loop().create_task(_run())
        return log
