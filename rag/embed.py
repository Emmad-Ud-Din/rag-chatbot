import os
import time
from typing import Literal

import requests

URL = "https://api.voyageai.com/v1/embeddings"
MODEL = "voyage-3.5"


def embed(texts: list[str], input_type: Literal["document", "query"]) -> list[list[float]]:
    """Text in, vectors out. Chunks and questions must use the SAME model.

    "document" is for stored passages, "query" is for user questions.
    """
    for _ in range(4):
        res = requests.post(
            URL,
            headers={"Authorization": f"Bearer {os.environ['VOYAGE_API_KEY']}"},
            json={"input": texts, "model": MODEL, "input_type": input_type},
            timeout=60,
        )

        # Rate limited: wait and retry (capped at 4 attempts).
        if res.status_code == 429:
            time.sleep(21)
            continue

        if not res.ok:
            raise RuntimeError(f"Embedding failed: {res.status_code} {res.text}")

        return [d["embedding"] for d in res.json()["data"]]

    raise RuntimeError("Embedding failed: still rate limited after retries")
