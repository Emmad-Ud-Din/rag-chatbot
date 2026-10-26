"""Run once (and again whenever the handbook or embedding model changes).

Splits the handbook, embeds every chunk, and saves everything to data/index.json.
"""

import json
from pathlib import Path

from rag.chunk import load_chunks
from rag.embed import embed


def main() -> None:
    chunks = load_chunks()
    vectors = embed([c.text for c in chunks], "document")

    index = [
        {"section": c.section, "text": c.text, "vector": v}
        for c, v in zip(chunks, vectors)
    ]
    Path("data/index.json").write_text(json.dumps(index), encoding="utf-8")
    print(f"Saved {len(index)} chunks")


if __name__ == "__main__":
    main()
