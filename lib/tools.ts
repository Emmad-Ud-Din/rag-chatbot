// The leave calculator the model can call. The model reads the rules from the
// handbook and passes them in; this code does the date math and arithmetic,
// which have to be exact.
export function calculateLeave(args: {
  joinDate: string;          // "2020-03-01"
  daysUsed: number;          // annual leave days used this year
  carriedOver: number;       // days the employee says they carried over from last year
  baseDays: number;          // from the handbook, e.g. 20
  increasedDays: number;     // from the handbook, e.g. 25
  yearsNeeded: number;       // from the handbook, e.g. 5
  maxCarryOver: number;      // from the handbook, e.g. 5
  carryOverExpires: string;  // from the handbook, "MM-DD", e.g. "03-31"
}, today: Date = new Date()) {
  // Check the inputs first. A bad date would otherwise give a wrong answer silently.
  const [y, m, d] = args.joinDate.split("-").map(Number);
  const joined = new Date(y, m - 1, d);
  // new Date(2020, 1, 30) silently becomes 1 March, so also check the parts survived.
  if (isNaN(joined.getTime()) || joined.getMonth() !== m - 1 || joined.getDate() !== d) {
    return { error: `"${args.joinDate}" is not a date. Ask the employee for their exact join date.` };
  }
  if (joined > today) {
    return { error: "The join date is in the future. Ask the employee to check it." };
  }
  if (args.daysUsed < 0 || args.carriedOver < 0) {
    return { error: "Days used and days carried over cannot be negative." };
  }

  // Full years of service: subtract the years, then take one off if this
  // year's anniversary hasn't happened yet.
  let years = today.getFullYear() - joined.getFullYear();
  const anniversary = new Date(today.getFullYear(), joined.getMonth(), joined.getDate());
  if (today < anniversary) years--;

  const allowance = years >= args.yearsNeeded ? args.increasedDays : args.baseDays;

  // Carried-over days count only until the expiry date this year, and never
  // more than the handbook allows.
  const [month, day] = args.carryOverExpires.split("-").map(Number);
  const expiry = new Date(today.getFullYear(), month - 1, day, 23, 59, 59);
  const carried = Math.min(args.carriedOver, args.maxCarryOver);
  const carryOverValid = today < expiry;
  const validCarryOver = carryOverValid ? carried : 0;

  const remaining = allowance + validCarryOver - args.daysUsed;

  // Everything the model needs to explain the result, not only the final number.
  const result = {
    yearsOfService: years,
    allowance,
    carriedOverClaimed: args.carriedOver,
    carriedOverAllowed: carried,          // after the maximum is applied
    carriedOverCounted: validCarryOver,   // after the expiry date is applied
    carriedOverExpired: args.carriedOver > 0 && !carryOverValid,
    daysUsed: args.daysUsed,
  };

  if (remaining < 0) {
    return { ...result, remaining: 0, overBy: -remaining };
  }
  return { ...result, remaining };
}

// What the model sees. It never sees the code above, only this description,
// so the descriptions are what it uses to decide when to call the tool and what to pass.
export const leaveTool = {
  type: "function",
  function: {
    name: "calculate_leave",
    description:
      "Calculates how many annual leave days an employee has left this year. It knows today's date, so never ask the employee for the current date or year. Use it when the employee gives their join date and asks about remaining annual leave. Take the leave numbers from the handbook sections.",
    parameters: {
      type: "object",
      properties: {
        joinDate: { type: "string", description: "Join date in YYYY-MM-DD format" },
        daysUsed: { type: "number", description: "Annual leave days already used this calendar year" },
        carriedOver: { type: "number", description: "Exactly the number the employee says they carried over, even if it is more than the maximum. If the employee does not mention carry-over, pass 0 and do not ask about it: the tool knows today's date and applies the maximum and the expiry date itself." },
        baseDays: { type: "number", description: "Annual leave days per year from the handbook" },
        increasedDays: { type: "number", description: "Annual leave days after the required years of service, from the handbook" },
        yearsNeeded: { type: "number", description: "Years of service needed for the increased days, from the handbook" },
        maxCarryOver: { type: "number", description: "Maximum days that can be carried over, from the handbook" },
        carryOverExpires: { type: "string", description: "Date carried-over days expire, as MM-DD, from the handbook" },
      },
      required: [
        "joinDate", "daysUsed", "carriedOver", "baseDays", "increasedDays",
        "yearsNeeded", "maxCarryOver", "carryOverExpires",
      ],
    },
  },
};