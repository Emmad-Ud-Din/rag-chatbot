"""One place for calling Groq, with retries, used by both the bot and the judge.

Retry only temporary errors (429 rate limit, 5xx server problems), and only when
the wait is short. A 400 or 401 fails the same way every time, so it is not
retried. A long wait (the daily token cap says "try again in 2m23s") is not worth
making someone stare at a spinner for, so it fails fast instead.
"""

import math
import os
import re
import sys
import time

import requests

URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_RETRIES = 2
MAX_WAIT_SECONDS = 10


class ApiError(Exception):
    """Raised when an API call fails (Groq here, Voyage in embed.py). `temporary`
    tells the caller whether trying again later could work, so the chat UI can
    show "busy, try again" instead of "something went wrong"."""

    def __init__(self, service: str, status: int, detail: str, temporary: bool, retry_after: float | None):
        super().__init__(f"{service} failed: {status} {detail}")
        self.service = service
        self.status = status
        self.detail = detail
        self.temporary = temporary
        self.retry_after = retry_after  # seconds


def _wait_from_response(res: requests.Response) -> float | None:
    """Groq sends `retry-after` in seconds. Its error text also says
    "Please try again in 2m23.856s", which is used when the header is missing."""
    try:
        header = float(res.headers.get("retry-after", ""))
        if header > 0:
            return header
    except ValueError:
        pass
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", res.text)
    if m:
        return int(m.group(1) or 0) * 60 + float(m.group(2))
    return None


def call_groq(body: dict, sleep=time.sleep) -> dict:
    """`sleep` is a parameter so tests can skip the real waiting."""
    attempt = 0
    while True:
        res = requests.post(
            URL,
            headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
            json=body,
            timeout=120,
        )
        if res.ok:
            return res.json()

        temporary = res.status_code == 429 or res.status_code >= 500
        # Use Groq's own wait if it gave one, otherwise back off: 1s, then 2s.
        wait = _wait_from_response(res)
        if wait is None:
            wait = 2**attempt

        if not temporary or attempt >= MAX_RETRIES or wait > MAX_WAIT_SECONDS:
            raise ApiError("Groq", res.status_code, res.text, temporary, wait if temporary else None)
        print(f"Groq {res.status_code}, retrying in {round(wait)}s", file=sys.stderr)
        sleep(wait)
        attempt += 1


def friendly_error(err: Exception) -> str:
    """What to show the employee when a request failed. Lives here so every
    interface (terminal script now, chat UI later) says the same thing."""
    if isinstance(err, ApiError) and err.temporary:
        minutes = math.ceil(err.retry_after / 60) if err.retry_after else 1
        return f"The assistant is busy right now. Please try again in about {minutes} minute{'' if minutes == 1 else 's'}."
    return "Something went wrong on our side. Please try again later, or ask HR or your manager."
