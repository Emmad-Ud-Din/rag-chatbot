import { answer } from "../lib/answer";

// Usage: npx tsx --env-file=.env.local scripts/try-answer.ts "your question"
async function main() {
  const question =
    process.argv[2] ?? "What should I do if my laptop got damaged?";
  const result = await answer(question);
  console.log(result.answer);
}

main();
