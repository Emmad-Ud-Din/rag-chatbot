import { retrieve } from "../lib/retrieve";

// Usage: npx tsx --env-file=.env.local scripts/try-retrieve.ts "your question"
async function main() {
  const question = process.argv[2] ?? "How many days off do I get per year?";
  const results = await retrieve(question);
  for (const r of results) console.log(r.section, r.score.toFixed(3));
}

main();
