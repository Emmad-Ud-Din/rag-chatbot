"""Unit tests for the leave calculator. No API calls, no tokens.

Each test fixes "today", so results never change with the calendar.

    python test_tools.py
"""

import sys
from datetime import date

from rag.tools import calculate_leave

RULES = {"baseDays": 20, "increasedDays": 25, "yearsNeeded": 5, "maxCarryOver": 5, "carryOverExpires": "03-31"}

TESTS = [
    ("6 years, carry-over expired",
     {**RULES, "joinDate": "2020-03-01", "daysUsed": 8, "carriedOver": 5}, date(2026, 10, 28),
     {"remaining": 17, "carriedOverCounted": 0, "carriedOverExpired": True}),
    ("7 years, carry-over still valid",
     {**RULES, "joinDate": "2020-03-01", "daysUsed": 8, "carriedOver": 5}, date(2027, 3, 15),
     {"remaining": 22, "carriedOverCounted": 5}),
    ("day before 5th anniversary",
     {**RULES, "joinDate": "2021-11-15", "daysUsed": 3, "carriedOver": 0}, date(2026, 11, 14),
     {"remaining": 17, "yearsOfService": 4}),
    ("on 5th anniversary",
     {**RULES, "joinDate": "2021-11-15", "daysUsed": 3, "carriedOver": 0}, date(2026, 11, 15),
     {"remaining": 22, "yearsOfService": 5}),
    ("carry-over capped at the maximum",
     {**RULES, "joinDate": "2020-03-01", "daysUsed": 8, "carriedOver": 7}, date(2027, 3, 15),
     {"remaining": 22, "carriedOverClaimed": 7, "carriedOverAllowed": 5, "carriedOverCounted": 5}),
    ("carry-over valid on 31 March",
     {**RULES, "joinDate": "2020-03-01", "daysUsed": 0, "carriedOver": 5}, date(2027, 3, 31),
     {"carriedOverCounted": 5}),
    ("carry-over expired on 1 April",
     {**RULES, "joinDate": "2020-03-01", "daysUsed": 0, "carriedOver": 5}, date(2027, 4, 1),
     {"carriedOverCounted": 0, "carriedOverExpired": True}),
    ("more days used than available",
     {**RULES, "joinDate": "2020-03-01", "daysUsed": 30, "carriedOver": 0}, date(2026, 10, 28),
     {"remaining": 0, "overBy": 5}),
    ("date that does not exist",
     {**RULES, "joinDate": "2020-02-30", "daysUsed": 0, "carriedOver": 0}, date(2026, 10, 28),
     {"error": '"2020-02-30" is not a date. Ask the employee for their exact join date.'}),
    ("join date in the future",
     {**RULES, "joinDate": "2027-01-01", "daysUsed": 0, "carriedOver": 0}, date(2026, 10, 28),
     {"error": "The join date is in the future. Ask the employee to check it."}),
    ("joined on 29 February, anniversary on 1 March in other years",
     {**RULES, "joinDate": "2020-02-29", "daysUsed": 0, "carriedOver": 0}, date(2025, 2, 28),
     {"yearsOfService": 4}),
]


def main() -> None:
    failed = 0
    for name, args, today, expect in TESTS:
        result = calculate_leave(args, today)
        wrong = {k: v for k, v in expect.items() if result.get(k) != v}
        if wrong:
            failed += 1
        print("FAIL" if wrong else "PASS", name, "| got", result)
    print(f"\nAll {len(TESTS)} passed" if failed == 0 else f"\n{failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
