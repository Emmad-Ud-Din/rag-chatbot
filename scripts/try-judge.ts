import { judge } from "../lib/judge";

// Sanity check for the judge: three answers where the right verdict is known.
// Expected: A FAIL (missing the 25-day rule), B PASS, C FAIL (invented rule).

const sources =
  "## 2. Annual Leave Entitlement\n\nFull-time employees receive 20 days of paid annual leave per calendar year. This increases to 25 days after five years of service.\n\n---\n\n## 10. Laptop and Equipment Policy\n\nEvery new employee receives a company laptop. Laptops are replaced every 3 years. Lost or stolen equipment must be reported to IT within 24 hours.";

const q3 = {
  question: "How many days can I take off?",
  reference:
    "20 days of paid annual leave per year, increasing to 25 after five years of service. Sick leave (10 days) and public holidays (12 days) are separate.",
  type: "answerable",
};

const q8 = {
  question: "What should I do if my laptop got damaged?",
  reference:
    "Should say the handbook does not cover damaged laptops. May mention the lost or stolen rule, but must not present it as the rule for damage.",
  type: "unanswerable",
};

async function main() {
  const cases = [
    { name: "A", item: q3, answer: "You get 20 days of paid annual leave per year." },
    {
      name: "B",
      item: q8,
      answer:
        "The handbook does not address damaged laptops. It only covers lost or stolen equipment. Please ask HR or your manager.",
    },
    {
      name: "C",
      item: q8,
      answer: "If your laptop is damaged, report it to IT within 24 hours.",
    },
  ];

  for (const c of cases) {
    const v = await judge(c.item, c.answer, sources);
    console.log(c.name, v.pass ? "PASS" : "FAIL", "|", v.reason.slice(0, 150));
  }
}

main();
