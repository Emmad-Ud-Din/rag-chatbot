"""The leave calculator the model can call.

The model reads the rules from the handbook and passes them in; this code does
the date math and arithmetic, which have to be exact.
"""

from datetime import date


def _anniversary(joined: date, year: int) -> date:
    """The join date's anniversary in `year`. Someone who joined on 29 February
    has their anniversary on 1 March in other years (the same as JavaScript's Date)."""
    try:
        return date(year, joined.month, joined.day)
    except ValueError:
        return date(year, 3, 1)


def calculate_leave(args: dict, today: date | None = None) -> dict:
    """`today` defaults to the real date. Tests pass a fixed one."""
    today = today or date.today()

    # Check the inputs first. A bad date would otherwise give a wrong answer.
    # fromisoformat rejects text like "next month" and dates that do not exist (2020-02-30).
    try:
        joined = date.fromisoformat(str(args["joinDate"]))
    except ValueError:
        return {"error": f'"{args["joinDate"]}" is not a date. Ask the employee for their exact join date.'}
    if joined > today:
        return {"error": "The join date is in the future. Ask the employee to check it."}
    if args["daysUsed"] < 0 or args["carriedOver"] < 0:
        return {"error": "Days used and days carried over cannot be negative."}

    # Full years of service: subtract the years, then take one off if this
    # year's anniversary hasn't happened yet.
    years = today.year - joined.year
    if today < _anniversary(joined, today.year):
        years -= 1

    allowance = args["increasedDays"] if years >= args["yearsNeeded"] else args["baseDays"]

    # Carried-over days count only until the expiry date this year (the expiry
    # day itself included), and never more than the handbook allows.
    month, day = (int(p) for p in str(args["carryOverExpires"]).split("-"))
    expiry = date(today.year, month, day)
    carried = min(args["carriedOver"], args["maxCarryOver"])
    carry_over_valid = today <= expiry
    valid_carry_over = carried if carry_over_valid else 0

    remaining = allowance + valid_carry_over - args["daysUsed"]

    # Everything the model needs to explain the result, not only the final number.
    result = {
        "yearsOfService": years,
        "allowance": allowance,
        "carriedOverClaimed": args["carriedOver"],
        "carriedOverAllowed": carried,  # after the maximum is applied
        "carriedOverCounted": valid_carry_over,  # after the expiry date is applied
        "carriedOverExpired": args["carriedOver"] > 0 and not carry_over_valid,
        "daysUsed": args["daysUsed"],
    }

    if remaining < 0:
        return {**result, "remaining": 0, "overBy": -remaining}
    return {**result, "remaining": remaining}


# What the model sees. It never sees the code above, only this description,
# so the descriptions are what it uses to decide when to call the tool and what to pass.
LEAVE_TOOL = {
    "type": "function",
    "function": {
        "name": "calculate_leave",
        "description": (
            "Calculates how many annual leave days an employee has left this year. "
            "It knows today's date, so never ask the employee for the current date or year. "
            "Use it when the employee gives their join date and asks about remaining annual "
            "leave. Take the leave numbers from the handbook sections."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "joinDate": {"type": "string", "description": "Join date in YYYY-MM-DD format"},
                "daysUsed": {"type": "number", "description": "Annual leave days already used this calendar year"},
                "carriedOver": {
                    "type": "number",
                    "description": (
                        "Exactly the number the employee says they carried over, even if it is "
                        "more than the maximum. The tool applies the maximum and the expiry date itself."
                    ),
                },
                "baseDays": {"type": "number", "description": "Annual leave days per year from the handbook"},
                "increasedDays": {
                    "type": "number",
                    "description": "Annual leave days after the required years of service, from the handbook",
                },
                "yearsNeeded": {
                    "type": "number",
                    "description": "Years of service needed for the increased days, from the handbook",
                },
                "maxCarryOver": {"type": "number", "description": "Maximum days that can be carried over, from the handbook"},
                "carryOverExpires": {
                    "type": "string",
                    "description": "Date carried-over days expire, as MM-DD, from the handbook",
                },
            },
            "required": [
                "joinDate", "daysUsed", "carriedOver", "baseDays", "increasedDays",
                "yearsNeeded", "maxCarryOver", "carryOverExpires",
            ],
        },
    },
}

TOOLS = {"calculate_leave": calculate_leave}
