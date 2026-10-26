"""Run every question in data/evals.json and print two scores:

- retrieval hit rate: was the right section in the top 3?
- answer correctness: did the LLM judge pass the answer?
"""

import json
import time
from pathlib import Path

from rag.answer import answer
from rag.judge import judge

# Groq's free tier allows about 8,000 tokens per minute on this model,
# so wait between questions.
PAUSE_SECONDS = 45


def main() -> None:
    evals = json.loads(Path("data/evals.json").read_text(encoding="utf-8"))

    scorable = 0
    hits = 0
    passes = 0

    for e in evals:
        result = answer(e["question"])
        sections = [c["section"] for c in result["chunks"]]

        # Retrieval is scored only for questions that have a source section.
        retrieval = "n/a"
        if e["section"] is not None:
            scorable += 1
            if e["section"] in sections:
                hits += 1
                retrieval = f"rank {sections.index(e['section']) + 1}"
            else:
                retrieval = "MISS"

        # The judge sees the same sections the chatbot saw, so it can tell a true
        # extra detail from an invented one.
        sources = "\n\n---\n\n".join(c["text"] for c in result["chunks"])
        verdict = judge(e, result["answer"], sources)
        if verdict.passed:
            passes += 1

        print(
            f"Q{e['id']} [{e['type']}] retrieval: {retrieval} | "
            f"answer: {'PASS' if verdict.passed else 'FAIL'}"
        )
        print("   sections:", sections)
        print("   answer:", result["answer"])
        print("   judge:", verdict.reason)

        time.sleep(PAUSE_SECONDS)

    print(f"\nRetrieval hit rate: {hits}/{scorable}")
    print(f"Answer correctness: {passes}/{len(evals)}")


if __name__ == "__main__":
    main()
