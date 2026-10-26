import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Chunk:
    section: int
    text: str


def load_chunks(path: str = "data/handbook.md") -> list[Chunk]:
    """Split the handbook into one chunk per '## ' section."""
    text = Path(path).read_text(encoding="utf-8")

    chunks = []
    # Cut right before each "## " heading.
    for piece in re.split(r"\n(?=## )", text):
        # The first piece is the title block, not a section, so skip it.
        if not piece.startswith("## "):
            continue
        section = int(re.match(r"## (\d+)\.", piece).group(1))
        chunks.append(Chunk(section=section, text=piece.strip()))
    return chunks
