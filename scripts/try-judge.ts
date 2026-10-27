import { judge } from "../lib/judge";

// Sanity check for the judge: answers where the right verdict is known.
//
// Expected:
//   A FAIL  missing the 25-day rule
//   B PASS  the good laptop answer (a disclaimer that matters, since damage is not covered)
//   C FAIL  invented a rule (blatant)
//   D FAIL  false claim that the handbook does not mention other leave types
//   E FAIL  a softer version of C (stretches the lost/stolen rule to damage).
//           Known weak spot: the judge has passed it before.
//   F FAIL  true but needless disclaimer (sofa does not change the remote work answer)
//   G PASS  the same answer as F without the disclaimer
//
// Run all:       npx.cmd tsx --env-file=.env.local scripts/try-judge.ts
// Run some only: npx.cmd tsx --env-file=.env.local scripts/try-judge.ts F B
// Running only some cases also prints the judge's full reason.

const sources =
  "## 2. Annual Leave Entitlement\n\nFull-time employees receive 20 days of paid annual leave per calendar year. This increases to 25 days after five years of service.\n\n---\n\n## 10. Laptop and Equipment Policy\n\nEvery new employee receives a company laptop. Laptops are replaced every 3 years. Lost or stolen equipment must be reported to IT within 24 hours.";

const q3 = {
  question: "How many days can I take off?",
  reference:
    "20 days of paid annual leave per year, increasing to 25 after five years of service. The question is ambiguous, so a good answer may also mention sick leave (10 days) and public holidays (12 days), but these are optional.",
  type: "answerable",
};

const q4 = {
  question: "Are my leaves carried forward if unused?",
  reference:
    "Up to 5 unused annual leave days carry over to the next year and expire on March 31. Sick days do not carry over.",
  type: "answerable",
};

const q8 = {
  question: "What should I do if my laptop got damaged?",
  reference:
    "Should say the handbook does not cover damaged laptops. May mention the lost or stolen rule, but must not present it as the rule for damage.",
  type: "unanswerable",
};

const q10 = {
  question: "Can I work from my sofa every day?",
  reference:
    "Remote work is allowed up to 3 days per week. Fully remote (5 days) needs department head approval and is reviewed every 6 months.",
  type: "answerable",
};

async function main() {
  const cases = [
    { name: "A", item: q3, answer: "You get 20 days of paid annual leave per year." },
    {
      name: "B",
      item: q8,
      answer:
        "The handbook does not address damaged laptops. For equipment problems, it only covers lost or stolen equipment. Please ask HR or your manager.",
    },
    {
      name: "C",
      item: q8,
      answer: "If your laptop is damaged, report it to IT within 24 hours.",
    },
    {
      name: "D",
      item: q4,
      answer:
        "Up to 5 unused annual leave days carry over and expire on March 31. Sick days do not carry over. The handbook does not mention any other types of leave, so check with HR for other categories.",
    },
    {
      name: "E",
      item: q8,
      answer:
        "The handbook does not specifically mention damage, but the policy requires reporting lost or stolen equipment to IT within 24 hours, so reporting damage to IT follows the same principle.",
    },
    {
      name: "F",
      item: q10,
      answer:
        "You can work remotely up to 3 days per week. Fully remote needs department head approval and is reviewed every 6 months. The handbook does not say whether working from a sofa specifically is allowed; confirm with HR or your manager.",
    },
    {
      name: "G",
      item: q10,
      answer:
        "You can work remotely up to 3 days per week. Fully remote, all 5 days, needs department head approval and is reviewed every 6 months.",
    },
  ];

  // Optional: run only some cases by name. Shows the full reason.
  const only = process.argv.slice(2);
  const selected = only.length ? cases.filter((c) => only.includes(c.name)) : cases;

  if (selected.length === 0) {
    console.log("No cases match those names.");
    return;
  }

  for (const c of selected) {
    const v = await judge(c.item, c.answer, sources);
    const reason = only.length ? v.reason : v.reason.slice(0, 150);
    console.log(c.name, v.pass ? "PASS" : "FAIL", "|", reason);
  }
}

main();
