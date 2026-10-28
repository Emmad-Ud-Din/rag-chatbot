import os
import sys
import time
from typing import Literal

import requests

from .groq import ApiError

URL = "https://api.voyageai.com/v1/embeddings"
MODEL = "voyage-3.5"

# How long to keep trying on a 429 depends on who is waiting.
# "query": a person asked a question and is looking at a spinner, so give up
# after a few seconds and let the chat say "busy". "document": ingest, a one-off
# job nobody watches, where waiting is fine and giving up means starting over.
RETRY_RULES = {
    "query": {"attempts": 3, "wait": 2},
    "document": {"attempts": 4, "wait": 21},
}


def embed(texts: list[str], input_type: Literal["document", "query"], sleep=time.sleep) -> list[list[float]]:
    """Text in, vectors out. Chunks and questions must use the SAME model.

    "document" is for stored passages, "query" is for user questions.
    `sleep` is a parameter so tests can skip the real waiting.
    """
    rules = RETRY_RULES[input_type]
    attempt = 1
    while True:
        res = requests.post(
            URL,
            headers={"Authorization": f"Bearer {os.environ['VOYAGE_API_KEY']}"},
            json={"input": texts, "model": MODEL, "input_type": input_type},
            timeout=60,
        )
        if res.ok:
            return [d["embedding"] for d in res.json()["data"]]

        temporary = res.status_code == 429 or res.status_code >= 500
        # Only temporary errors are worth another try, and only up to the limit.
        if not temporary or attempt >= rules["attempts"]:
            raise ApiError("Voyage", res.status_code, res.text, temporary, 60 if temporary else None)
        print(f"Voyage {res.status_code}, retrying in {rules['wait']}s", file=sys.stderr)
        sleep(rules["wait"])
        attempt += 1
