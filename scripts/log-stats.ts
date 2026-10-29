import fs from "fs";
import path from "path";

// Averages from the request logs, grouped by retrieval mode, so changes like
// reranking can be compared on speed and cost, not only on eval scores.
// Usage: npx.cmd tsx scripts/log-stats.ts [YYYY-MM-DD]   (default: today)

const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const file = path.join("logs", `${day}.jsonl`);
if (!fs.existsSync(file)) {
  console.log(`No log file for ${day} (${file}).`);
  process.exit(0);
}

type Line = { retrieval?: string; ms?: number; firstTextMs?: number | null; tokens?: number; error?: string };
const lines: Line[] = fs
  .readFileSync(file, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const groups = new Map<string, Line[]>();
for (const l of lines) {
  // Lines written before the field existed count as plain vector search.
  const key = l.retrieval ?? "vector (older lines)";
  groups.set(key, [...(groups.get(key) ?? []), l]);
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : NaN);
for (const [mode, ls] of groups) {
  const ok = ls.filter((l) => !l.error);
  console.log(
    `${mode.padEnd(22)} requests: ${String(ls.length).padStart(3)}` +
      `  errors: ${ls.length - ok.length}` +
      `  avg ms: ${avg(ok.map((l) => l.ms ?? 0))}` +
      `  avg firstTextMs: ${avg(ok.map((l) => l.firstTextMs ?? NaN).filter((x) => !isNaN(x)))}` +
      `  avg Groq tokens: ${avg(ok.map((l) => l.tokens ?? 0))}`
  );
}
