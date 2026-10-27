import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import requests

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"


@lru_cache(maxsize=1)
def full_handbook() -> str:
    """The whole handbook, given to the judge as ground truth.

    The bot only sees the top 3 sections, so without this the judge cannot tell
    a true extra detail from an invented one, or a false "the handbook does not
    cover X" from a true one. This only works because the handbook is small.
    """
    return Path("data/handbook.md").read_text(encoding="utf-8")

JUDGE_PROMPT = """You grade answers from an employee handbook chatbot.
You are given a question, its type, a reference, the handbook sections the system retrieved, and the system's answer.
The reference is not handbook text. It is either the correct answer, or, for partial and unanswerable questions, a description of the correct behavior.

Rules by question type:

answerable:
- CORRECT only if the answer matches the reference in meaning. Different wording is fine.
- It must include the facts needed to answer the question correctly, such as the number and any condition that changes it. Extra context in the reference that the question did not ask about is optional.
- INCORRECT if a needed fact is missing or wrong, or if the answer contradicts the reference.

partial:
- CORRECT only if the answer gives the information described in the reference AND says clearly that the handbook does not cover the rest.
- INCORRECT if it guesses at the missing part or presents a guess as policy.

unanswerable:
- CORRECT only if the answer says the handbook does not cover the question and invents no policy.
- It may mention a related rule only if it says that rule is about a different situation.
- INCORRECT if it presents any rule, number, deadline, or procedure as the answer.

For all types:
- Before deciding, find every sentence in the answer that says the handbook does not mention, state, specify, provide, or cover something. Check each one against the full handbook. If any of them is false because the full handbook does cover it, the verdict is INCORRECT, even if the rest of the answer is right.
- The full handbook is provided as ground truth. A detail that is not in the reference is fine if it appears anywhere in the full handbook. It is INCORRECT only if it appears nowhere in it.
- INCORRECT if the answer says the handbook does not mention or cover something that the full handbook does cover, even if that part was not among the retrieved sections.
- INCORRECT if the answer states or implies a rule, eligibility, or procedure the full handbook does not contain, for example by saying a rule about one situation also applies to a different one.
- Suggesting the employee ask HR or their manager is fine.

Reply format: the first word must be exactly CORRECT or INCORRECT, followed by one or two sentences explaining why."""


@dataclass
class Verdict:
    passed: bool
    reason: str


def judge(item: dict, answer: str, sources: str) -> Verdict:
    """Grade one answer. `item` is one entry from data/evals.json."""
    res = requests.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
        json={
            "model": MODEL,
            "max_tokens": 1500,
            # 0 = same input gives the same verdict, so runs are comparable.
            "temperature": 0,
            "messages": [
                {"role": "system", "content": JUDGE_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Question: {item['question']}\n"
                        f"Question type: {item['type']}\n"
                        f"Reference: {item['reference']}\n"
                        f"Handbook sections the system retrieved:\n{sources}\n\n"
                        f"Full handbook (ground truth):\n{full_handbook()}\n\n"
                        f"System answer: {answer}"
                    ),
                },
            ],
        },
        timeout=120,
    )
    if not res.ok:
        raise RuntimeError(f"Judge failed: {res.status_code} {res.text}")

    text = res.json()["choices"][0]["message"]["content"]
    return Verdict(passed=text.strip().upper().startswith("CORRECT"), reason=text)
