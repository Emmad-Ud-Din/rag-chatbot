"""One JSON object per request, one per line ("JSON Lines"), in one file per day:
logs/2026-10-28.jsonl. Each line is complete on its own, so the files can be
searched or loaded by a script.

The logs hold employees' questions, which can include health and other personal
details, so they are kept out of git and deleted after RETENTION_DAYS.
"""

import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

LOG_DIR = Path("logs")
RETENTION_DAYS = 30
DAY_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl$")

_cleaned_day = ""


def prompt_version(*parts: str) -> str:
    """A short fingerprint of the prompt text. It changes whenever the prompt
    changes, so every log line shows which prompt produced it, without needing git."""
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()[:8]


def _day_of(time: datetime) -> str:
    """"2026-10-28" in UTC, the same as the `time` field in each line."""
    return time.astimezone(timezone.utc).strftime("%Y-%m-%d")


def delete_old_logs(now: datetime | None = None) -> None:
    """Delete day files older than RETENTION_DAYS. `now` is a parameter so tests
    can fix the date, like calculate_leave's `today`."""
    now = now or datetime.now(timezone.utc)
    if not LOG_DIR.exists():
        return
    cutoff = _day_of(now - timedelta(days=RETENTION_DAYS))
    for f in LOG_DIR.iterdir():
        m = DAY_FILE.match(f.name)
        # Dates in YYYY-MM-DD form sort correctly as text, so < compares them as dates.
        if m and m.group(1) < cutoff:
            f.unlink()


def log_request(entry: dict, now: datetime | None = None) -> None:
    global _cleaned_day
    now = now or datetime.now(timezone.utc)
    try:
        LOG_DIR.mkdir(exist_ok=True)
        today = _day_of(now)
        # Clean up once per day per process, not on every request.
        if _cleaned_day != today:
            delete_old_logs(now)
            _cleaned_day = today
        with open(LOG_DIR / f"{today}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as e:
        # A full disk or a locked file must not break the answer itself.
        print("Could not write log:", e, file=sys.stderr)
