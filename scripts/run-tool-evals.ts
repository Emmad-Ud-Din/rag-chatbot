import fs from "fs";
import { answer } from "../lib/answer";

// Checks that the model calls calculate_leave with the right arguments, or does
// not call it when it shouldn't. Exact comparisons, no judge.
// The final number depends on today's date, the arguments do not, so this is
// what the eval checks. The tool's math is covered by scripts/test-tools.ts.
// Usage: npx.cmd tsx --env-file=.env.local scripts/run-tool-evals.ts [ids]

type ToolEval = { id: number; question: string; expect: Record<string, unknown> | null };

const PAUSE_MS = 45000; // Groq tokens-per-minute limit

async function main() {
  const all: ToolEval[] = JSON.parse(fs.readFileSync("data/tool-evals.json", "utf-8"));
  // Optional: run only some ids, e.g. `... run-tool-evals.ts 4`
  const only = process.argv.slice(2).map(Number);
  const evals = only.length ? all.filter((e) => only.includes(e.id)) : all;

  if (evals.length === 0) {
    console.log("No questions match those ids.");
    return;
  }

  let passes = 0;

  for (const [i, e] of evals.entries()) {
    const result = await answer(e.question);
    const call = result.toolCalls.find((c) => c.name === "calculate_leave");

    const problems: string[] = [];
    if (e.expect === null) {
      if (call) problems.push(`tool was called but should not be: ${JSON.stringify(call.args)}`);
    } else if (!call) {
      problems.push("tool was not called");
    } else {
      // Compare each expected argument exactly.
      for (const [key, value] of Object.entries(e.expect)) {
        if (call.args?.[key] !== value) {
          problems.push(`${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(call.args?.[key])}`);
        }
      }
    }

    const pass = problems.length === 0;
    if (pass) passes++;
    console.log(`T${e.id} ${pass ? "PASS" : "FAIL"} | ${e.question}`);
    for (const p of problems) console.log("   ", p);
    console.log("   answer:", result.answer);

    if (i < evals.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(`\nTool calls correct: ${passes}/${evals.length}`);
}

main();
