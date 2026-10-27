"""Sanity check for the judge: answers where the right verdict is known.

Expected:
  A FAIL  missing the 25-day rule
  B PASS  the good laptop answer
  C FAIL  invented a rule (blatant)
  D FAIL  false claim that the handbook does not mention other leave types
  E       a softer version of C (stretches the lost/stolen rule to damage).
          This is a known weak spot: the judge may wrongly PASS it. If it does,
          the judge prompt needs work before a Q8 result can be trusted.
"""

from rag.judge import judge

SOURCES = (
    "## 2. Annual Leave Entitlement\n\n"
    "Full-time employees receive 20 days of paid annual leave per calendar year. "
    "This increases to 25 days after five years of service.\n\n---\n\n"
    "## 10. Laptop and Equipment Policy\n\n"
    "Every new employee receives a company laptop. Laptops are replaced every 3 years. "
    "Lost or stolen equipment must be reported to IT within 24 hours."
)

Q3 = {
    "question": "How many days can I take off?",
    "reference": (
        "20 days of paid annual leave per year, increasing to 25 after five years of "
        "service. The question is ambiguous, so a good answer may also mention sick "
        "leave (10 days) and public holidays (12 days), but these are optional."
    ),
    "type": "answerable",
}

Q4 = {
    "question": "Are my leaves carried forward if unused?",
    "reference": (
        "Up to 5 unused annual leave days carry over to the next year and expire on "
        "March 31. Sick days do not carry over."
    ),
    "type": "answerable",
}

Q8 = {
    "question": "What should I do if my laptop got damaged?",
    "reference": (
        "Should say the handbook does not cover damaged laptops. May mention the lost "
        "or stolen rule, but must not present it as the rule for damage."
    ),
    "type": "unanswerable",
}

CASES = [
    ("A", Q3, "You get 20 days of paid annual leave per year."),
    (
        "B",
        Q8,
        "The handbook does not address damaged laptops. It only covers lost or stolen "
        "equipment. Please ask HR or your manager.",
    ),
    ("C", Q8, "If your laptop is damaged, report it to IT within 24 hours."),
    (
        "D",
        Q4,
        "Up to 5 unused annual leave days carry over and expire on March 31. Sick days "
        "do not carry over. The handbook does not mention any other types of leave, so "
        "check with HR for other categories.",
    ),
    (
        "E",
        Q8,
        "The handbook does not specifically mention damage, but the policy requires "
        "reporting lost or stolen equipment to IT within 24 hours, so reporting damage "
        "to IT follows the same principle.",
    ),
]


def main() -> None:
    for name, item, answer in CASES:
        v = judge(item, answer, SOURCES)
        print(name, "PASS" if v.passed else "FAIL", "|", v.reason[:150])


if __name__ == "__main__":
    main()
