"""Check that the model calls calculate_leave with the right arguments, or does
not call it when it shouldn't. Exact comparisons, no judge.

The final number depends on today's date, the arguments do not, so this is what
the eval checks. The tool's math is covered by test_tools.py.

    python run_tool_evals.py        all questions
    python run_tool_evals.py 4      only some ids
"""

import json
import sys
import time
from pathlib import Path

from rag.answer import answer

PAUSE_SECONDS = 45  # Groq tokens-per-minute limit


def main() -> None:
    evals = json.loads(Path("data/tool-evals.json").read_text(encoding="utf-8"))
    only = [int(a) for a in sys.argv[1:]]
    selected = [e for e in evals if e["id"] in only] if only else evals

    if not selected:
        print("No questions match those ids.")
        return

    passes = 0
    for i, e in enumerate(selected):
        result = answer(e["question"])
        call = next((c for c in result["tool_calls"] if c["name"] == "calculate_leave"), None)

        problems = []
        if e["expect"] is None:
            if call:
                problems.append(f"tool was called but should not be: {json.dumps(call['args'])}")
        elif call is None:
            problems.append("tool was not called")
        else:
            # Compare each expected argument exactly.
            args = call["args"] or {}
            for key, value in e["expect"].items():
                if args.get(key) != value:
                    problems.append(f"{key}: expected {json.dumps(value)}, got {json.dumps(args.get(key))}")

        if not problems:
            passes += 1
        print(f"T{e['id']} {'PASS' if not problems else 'FAIL'} | {e['question']}")
        for p in problems:
            print("   ", p)
        print("   answer:", result["answer"])

        if i < len(selected) - 1:
            time.sleep(PAUSE_SECONDS)

    print(f"\nTool calls correct: {passes}/{len(selected)}")


if __name__ == "__main__":
    main()
