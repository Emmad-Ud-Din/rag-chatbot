import fs from "fs";
import { answer } from "../lib/answer";
import { judge } from "../lib/judge";
import { retrieve } from "../lib/retrieve";
import type { Turn } from "../lib/rewrite";

type EvalItem = {
  id: number;
  question: string;
  reference: string;
  // The section that holds the answer, or null if the handbook does not cover it.
  section?: number | null;
  // For questions that need several sections, e.g. [7, 8, 9]. Use this or `section`.
  sections?: number[];
  // Optional earlier messages, for follow-ups and for attacks that forge the
  // conversation (a fake "assistant" message the bot never wrote).
  history?: Turn[];
  type: string;
};

// Groq's free tier allows about 8,000 tokens per minute on this model,
// so wait between questions. Retrieval-only runs make no Groq calls and skip it.
// On a paid tier with higher limits, set PAUSE_MS=0 (or a few seconds).
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 45000);

// Flags sentences like "the handbook does not specify ...". The bot only sees the
// top 3 sections, so a claim about what the whole handbook lacks can be false, and
// the judge does not always catch it. The flag means "check by hand", not "wrong".
// It allows one word between the negation and the verb ("does not specifically address").
const ABSENCE =
  /(does not|doesn.t)( \w+)? (mention|specify|provide|state|cover|address|give|include|say)/i;

// The sections a question needs, or [] if the handbook does not cover it.
function neededSections(e: EvalItem): number[] {
  if (e.sections) return e.sections;
  return e.section == null ? [] : [e.section];
}

// How well retrieval did on one question, given the sections it returned.
// - found: needed sections that were retrieved
// - recall: share of needed sections found (partial credit, moves when retrieval gets closer)
// - full: true only if every needed section was found (can the bot answer completely?)
function scoreRetrieval(needed: number[], got: number[]) {
  const found = needed.filter((s) => got.includes(s));
  return { found, recall: found.length / needed.length, full: found.length === needed.length };
}

async function main() {
  const evals: EvalItem[] = JSON.parse(
    fs.readFileSync("data/evals.json", "utf-8")
  );

  // Usage:
  //   npx.cmd tsx --env-file=.env.local scripts/run-evals.ts              all questions
  //   npx.cmd tsx --env-file=.env.local scripts/run-evals.ts 10 8         only these ids
  //   npx.cmd tsx --env-file=.env.local scripts/run-evals.ts --retrieval-only
  // --retrieval-only checks which sections come back and nothing else: no answer,
  // no judge, no Groq tokens, no pause. Use it while changing how retrieval works.
  const args = process.argv.slice(2);
  const retrievalOnly = args.includes("--retrieval-only");
  const only = args.filter((a) => !a.startsWith("--")).map(Number);
  const selected = only.length
    ? evals.filter((e) => only.includes(e.id))
    : evals;

  if (selected.length === 0) {
    console.log("No questions match those ids.");
    return;
  }

  let scorable = 0;
  let fullCoverage = 0;
  let recallSum = 0;
  let passes = 0;
  let absenceClaims = 0;

  for (const [i, e] of selected.entries()) {
    const needed = neededSections(e);

    let result: Awaited<ReturnType<typeof answer>> | null = null;
    let sections: number[];
    if (retrievalOnly) {
      sections = (await retrieve(e.question)).map((c) => c.section);
    } else {
      result = await answer(e.question, e.history ?? []);
      sections = result.chunks.map((c) => c.section);
    }

    // Retrieval is scored only for questions that need at least one section.
    let retrieval = "n/a";
    if (needed.length > 0) {
      scorable++;
      const score = scoreRetrieval(needed, sections);
      recallSum += score.recall;
      if (score.full) fullCoverage++;
      retrieval =
        needed.length === 1
          ? score.full
            ? `rank ${sections.indexOf(needed[0]) + 1}`
            : "MISS"
          : `${score.found.length}/${needed.length} sections` +
            (score.full ? "" : ` (missing ${needed.filter((s) => !score.found.includes(s)).join(", ")})`);
    }

    if (!result) {
      console.log(`Q${e.id} retrieval: ${retrieval} | needed: [${needed.join(", ")}] | got: [${sections.join(", ")}]`);
      continue;
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
    if (result.notes) {
      console.log("   situation:", result.notes.employeeSituation);
      console.log("   covered:", result.notes.policyCoverage);
      console.log("   not covered:", result.notes.notCovered);
      console.log("   gap matters:", result.notes.gapMatters);
    }
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

  console.log(`\nRetrieval full coverage: ${fullCoverage}/${scorable} (every needed section in the top 3)`);
  console.log(`Retrieval recall: ${scorable ? (recallSum / scorable).toFixed(2) : "n/a"} (share of needed sections found)`);
  if (!retrievalOnly) {
    console.log(`Answer correctness: ${passes}/${selected.length}`);
    console.log(`Answerable questions with absence claims: ${absenceClaims}`);
  }
}

main();
