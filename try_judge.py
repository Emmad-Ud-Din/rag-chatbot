"""Sanity check for the judge: three answers where the right verdict is known.

Expected: A FAIL (missing the 25-day rule), B PASS, C FAIL (invented rule).
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
        "service. Sick leave (10 days) and public holidays (12 days) are separate."
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
]


def main() -> None:
    for name, item, answer in CASES:
        v = judge(item, answer, SOURCES)
        print(name, "PASS" if v.passed else "FAIL", "|", v.reason[:150])


if __name__ == "__main__":
    main()
