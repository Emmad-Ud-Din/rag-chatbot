import fs from "fs";
import { answer } from "../lib/answer";
import type { Turn } from "../lib/rewrite";

// Checks that the model calls calculate_leave with the right arguments, or does
// not call it when it shouldn't. Exact comparisons, no judge.
// The final number depends on today's date, the arguments do not, so this is
// what the eval checks. The tool's math is covered by scripts/test-tools.ts.
// Usage: npx.cmd tsx --env-file=.env.local scripts/run-tool-evals.ts [ids]

type ToolEval = {
  id: number;
  question: string;
  // What the model should pass to calculate_leave, or null if it should not call it.
  expect: Record<string, unknown> | null;
  // Optional: earlier messages, for follow-up questions.
  history?: Turn[];
  // Optional: words the rewritten question must (or must not) contain. The rewrite
  // is a separate step that can lose details even when the final answer looks right.
  rewriteMustContain?: string[];
  rewriteMustNotContain?: string[];
};

const PAUSE_MS = Number(process.env.PAUSE_MS ?? 45000); // Groq tokens-per-minute limit; PAUSE_MS=0 for offline tests

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
    const result = await answer(e.question, e.history ?? []);
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

    // Checks on the rewritten question, case-insensitive.
    const rewritten = result.searchQuestion.toLowerCase();
    for (const word of e.rewriteMustContain ?? []) {
      if (!rewritten.includes(word.toLowerCase())) problems.push(`rewrite is missing "${word}": ${result.searchQuestion}`);
    }
    for (const word of e.rewriteMustNotContain ?? []) {
      if (rewritten.includes(word.toLowerCase())) problems.push(`rewrite should not contain "${word}": ${result.searchQuestion}`);
    }

    const pass = problems.length === 0;
    if (pass) passes++;
    console.log(`T${e.id} ${pass ? "PASS" : "FAIL"} | ${e.question}`);
    if (e.history?.length) console.log("   rewritten:", result.searchQuestion);
    for (const p of problems) console.log("   ", p);
    console.log("   answer:", result.answer);

    if (i < evals.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(`\nTool calls correct: ${passes}/${evals.length}`);
}

main();
