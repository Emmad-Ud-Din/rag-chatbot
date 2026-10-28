import { answer } from "../lib/answer";
import { friendlyError } from "../lib/groq";

// Usage: npx tsx --env-file=.env.local scripts/try-answer.ts "your question"
async function main() {
  const question =
    process.argv[2] ?? "What should I do if my laptop got damaged?";
  try {
    const result = await answer(question);
    console.log(result.answer);
  } catch (err) {
    // What the employee would see, then the real error for you.
    console.log(friendlyError(err));
    console.error(String(err));
  }
}

main();
