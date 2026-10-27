import fs from "fs";
import { answer } from "../lib/answer";
import { judge } from "../lib/judge";

type EvalItem = {
  id: number;
  question: string;
  reference: string;
  section: number | null;
  type: string;
};

// Groq's free tier allows about 8,000 tokens per minute on this model,
// so wait between questions.
const PAUSE_MS = 45000;

// Flags sentences like "the handbook does not specify ...". The bot only sees the
// top 3 sections, so a claim about what the whole handbook lacks can be false, and
// the judge does not always catch it. The flag means "check by hand", not "wrong".
// It allows one word between the negation and the verb ("does not specifically address").
const ABSENCE =
  /(does not|doesn.t)( \w+)? (mention|specify|provide|state|cover|address|give|include|say)/i;

async function main() {
  const evals: EvalItem[] = JSON.parse(
    fs.readFileSync("data/evals.json", "utf-8")
  );

  // Optional: run only some ids, e.g. `npx.cmd tsx --env-file=.env.local scripts/run-evals.ts 10 8`.
  // With no ids, all questions run. Saves tokens when checking one question.
  const only = process.argv.slice(2).map(Number);
  const selected = only.length
    ? evals.filter((e) => only.includes(e.id))
    : evals;

  if (selected.length === 0) {
    console.log("No questions match those ids.");
    return;
  }

  let scorable = 0;
  let hits = 0;
  let passes = 0;
  let absenceClaims = 0;

  for (const [i, e] of selected.entries()) {
    const result = await answer(e.question);
    const sections = result.chunks.map((c) => c.section);

    // Retrieval is scored only for questions that have a source section.
    let retrieval = "n/a";
    if (e.section !== null) {
      scorable++;
      const rank = sections.indexOf(e.section);
      if (rank !== -1) {
        hits++;
        retrieval = `rank ${rank + 1}`;
      } else {
        retrieval = "MISS";
      }
    }

    // The judge sees the same sections the chatbot saw, plus the full handbook
    // (added inside judge.ts), so it can tell a true extra detail from an invented one.
    const sources = result.chunks.map((c) => c.text).join("\n\n---\n\n");
    const verdict = await judge(e, result.answer, sources);
    if (verdict.pass) passes++;

    console.log(
      `Q${e.id} [${e.type}] retrieval: ${retrieval} | answer: ${verdict.pass ? "PASS" : "FAIL"}`
    );
    console.log("   sections:", sections);
    console.log("   answer:", result.answer);
    console.log("   judge:", verdict.reason);

    // Only answerable questions: for partial and unanswerable ones, saying what
    // the handbook does not cover is the correct behavior.
    if (e.type === "answerable" && ABSENCE.test(result.answer)) {
      absenceClaims++;
      console.log("   ABSENCE CLAIM, check by hand");
    }

    // No point waiting after the last question.
    if (i < selected.length - 1) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  console.log(`\nRetrieval hit rate: ${hits}/${scorable}`);
  console.log(`Answer correctness: ${passes}/${selected.length}`);
  console.log(`Answerable questions with absence claims: ${absenceClaims}`);
}

main();
