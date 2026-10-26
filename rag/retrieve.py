import json
import math
from functools import lru_cache
from pathlib import Path

from .embed import embed

INDEX_PATH = Path("data/index.json")


@lru_cache(maxsize=1)
def load_index() -> list[dict]:
    """Read the saved vectors once, the first time they are needed."""
    if not INDEX_PATH.exists():
        raise FileNotFoundError("data/index.json not found. Run: python ingest.py")
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    return dot / (norm_a * norm_b)


def retrieve(question: str, k: int = 3) -> list[dict]:
    """Return the k chunks closest in meaning to the question."""
    query_vector = embed([question], "query")[0]

    scored = [
        {"section": c["section"], "text": c["text"], "score": cosine(query_vector, c["vector"])}
        for c in load_index()
    ]
    scored.sort(key=lambda c: c["score"], reverse=True)
    return scored[:k]
