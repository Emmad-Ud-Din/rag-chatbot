import { calculateLeave } from "../lib/tools";

// Unit tests for the leave calculator. No API calls, no tokens.
// Each test fixes "today", so results never change with the calendar.
// Usage: npx.cmd tsx scripts/test-tools.ts

const rules = { baseDays: 20, increasedDays: 25, yearsNeeded: 5, maxCarryOver: 5, carryOverExpires: "03-31" };

// Months in new Date(year, month, day) start at 0: 9 = October, 2 = March.
const tests: { name: string; args: any; today: Date; expect: Record<string, unknown> }[] = [
  {
    name: "6 years, carry-over expired",
    args: { ...rules, joinDate: "2020-03-01", daysUsed: 8, carriedOver: 5 },
    today: new Date(2026, 9, 28),
    expect: { remaining: 17, carriedOverCounted: 0, carriedOverExpired: true },
  },
  {
    name: "7 years, carry-over still valid",
    args: { ...rules, joinDate: "2020-03-01", daysUsed: 8, carriedOver: 5 },
    today: new Date(2027, 2, 15),
    expect: { remaining: 22, carriedOverCounted: 5 },
  },
  {
    name: "day before 5th anniversary",
    args: { ...rules, joinDate: "2021-11-15", daysUsed: 3, carriedOver: 0 },
    today: new Date(2026, 10, 14),
    expect: { remaining: 17, yearsOfService: 4 },
  },
  {
    name: "on 5th anniversary",
    args: { ...rules, joinDate: "2021-11-15", daysUsed: 3, carriedOver: 0 },
    today: new Date(2026, 10, 15),
    expect: { remaining: 22, yearsOfService: 5 },
  },
  {
    name: "carry-over capped at the maximum",
    args: { ...rules, joinDate: "2020-03-01", daysUsed: 8, carriedOver: 7 },
    today: new Date(2027, 2, 15),
    expect: { remaining: 22, carriedOverClaimed: 7, carriedOverAllowed: 5, carriedOverCounted: 5 },
  },
  {
    name: "carry-over valid on 31 March",
    args: { ...rules, joinDate: "2020-03-01", daysUsed: 0, carriedOver: 5 },
    today: new Date(2027, 2, 31, 12),
    expect: { carriedOverCounted: 5 },
  },
  {
    name: "carry-over expired on 1 April",
    args: { ...rules, joinDate: "2020-03-01", daysUsed: 0, carriedOver: 5 },
    today: new Date(2027, 3, 1, 12),
    expect: { carriedOverCounted: 0, carriedOverExpired: true },
  },
  {
    name: "more days used than available",
    args: { ...rules, joinDate: "2020-03-01", daysUsed: 30, carriedOver: 0 },
    today: new Date(2026, 9, 28),
    expect: { remaining: 0, overBy: 5 },
  },
  {
    name: "date that does not exist",
    args: { ...rules, joinDate: "2020-02-30", daysUsed: 0, carriedOver: 0 },
    today: new Date(2026, 9, 28),
    expect: { error: '"2020-02-30" is not a date. Ask the employee for their exact join date.' },
  },
  {
    name: "join date in the future",
    args: { ...rules, joinDate: "2027-01-01", daysUsed: 0, carriedOver: 0 },
    today: new Date(2026, 9, 28),
    expect: { error: "The join date is in the future. Ask the employee to check it." },
  },
];

let failed = 0;
for (const t of tests) {
  const result: any = calculateLeave(t.args, t.today);
  const wrong = Object.entries(t.expect).filter(([k, v]) => result[k] !== v);
  if (wrong.length) failed++;
  console.log(wrong.length ? "FAIL" : "PASS", t.name, "| got", JSON.stringify(result));
}
console.log(failed === 0 ? `\nAll ${tests.length} passed` : `\n${failed} failed`);
process.exitCode = failed ? 1 : 0;
