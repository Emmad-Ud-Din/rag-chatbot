import { answerStream } from "../lib/answer";
import { describeError, friendlyError } from "../lib/groq";

// Usage: npx tsx --env-file=.env.local scripts/try-answer.ts "your question"
// Prints the answer as it streams: status lines in grey, then the text piece by piece.
async function main() {
  const question =
    process.argv[2] ?? "What should I do if my laptop got damaged?";
  try {
    for await (const event of answerStream(question)) {
      if (event.type === "status") console.log(`\x1b[90m${event.text}\x1b[0m`);
      if (event.type === "text") process.stdout.write(event.delta);
      if (event.type === "done") process.stdout.write("\n");
    }
  } catch (err) {
    // What the employee would see, then the real error for you.
    console.log(friendlyError(err));
    console.error(describeError(err));
  }
}

main();
