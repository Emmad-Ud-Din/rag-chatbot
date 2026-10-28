"""Ask the chatbot one question.

    python ask.py "How many sick days do I get?"
    python ask.py "How many sick days do I get?" --retrieve-only
"""

import argparse
import sys

from rag.answer import answer_stream
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

    # Print the answer as it streams: status lines in grey, then the text piece by piece.
    try:
        for event in answer_stream(args.question):
            if event["type"] == "status":
                print(f"\x1b[90m{event['text']}\x1b[0m")
            elif event["type"] == "text":
                # flush, or Python holds the pieces back until a newline.
                print(event["delta"], end="", flush=True)
            elif event["type"] == "done":
                print()
                print("sections:", [c["section"] for c in event["result"]["chunks"]])
    except Exception as e:
        # What the employee would see, then the real error for you.
        print(friendly_error(e))
        print(e, file=sys.stderr)


if __name__ == "__main__":
    main()
