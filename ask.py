"""Ask the chatbot one question.

    python ask.py "How many sick days do I get?"
    python ask.py "How many sick days do I get?" --retrieve-only
"""

import argparse
import sys

from rag.answer import answer
from rag.groq import friendly_error
from rag.retrieve import retrieve


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "question",
        nargs="?",
        default="What should I do if my laptop got damaged?",
    )
    parser.add_argument(
        "--retrieve-only",
        action="store_true",
        help="only show which sections were retrieved and their scores",
    )
    args = parser.parse_args()

    if args.retrieve_only:
        for r in retrieve(args.question):
            print(r["section"], f"{r['score']:.3f}")
        return

    try:
        result = answer(args.question)
    except Exception as e:
        # What the employee would see, then the real error for you.
        print(friendly_error(e))
        print(e, file=sys.stderr)
        return
    print("sections:", [c["section"] for c in result["chunks"]])
    print(result["answer"])


if __name__ == "__main__":
    main()
