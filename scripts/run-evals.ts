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

async function main() {
  const evals: EvalItem[] = JSON.parse(
    fs.readFileSync("data/evals.json", "utf-8")
  );

  let scorable = 0;
  let hits = 0;
  let passes = 0;

  for (const e of evals) {
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

    // The judge sees the same sections the chatbot saw, so it can tell a true
    // extra detail from an invented one.
    const sources = result.chunks.map((c) => c.text).join("\n\n---\n\n");
    const verdict = await judge(e, result.answer, sources);
    if (verdict.pass) passes++;

    console.log(
      `Q${e.id} [${e.type}] retrieval: ${retrieval} | answer: ${verdict.pass ? "PASS" : "FAIL"}`
    );
    if (!verdict.pass) {
      console.log("   answer:", result.answer.slice(0, 200));
      console.log("   judge:", verdict.reason.slice(0, 200));
    }

    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(`\nRetrieval hit rate: ${hits}/${scorable}`);
  console.log(`Answer correctness: ${passes}/${evals.length}`);
}

main();
