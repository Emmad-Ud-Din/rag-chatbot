import fs from "fs";
import { embed } from "./embed";
import { rerank } from "./rerank";
import type { Chunk } from "./chunk";

type IndexedChunk = Chunk & { vector: number[] };

// Loaded once at startup, not on every question.
const index: IndexedChunk[] = JSON.parse(
  fs.readFileSync("data/index.json", "utf-8")
);

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Reranking is switched on with RERANK=1, so the same evals can run with and
// without it and be compared before it becomes the default.
const RERANK = process.env.RERANK === "1";
// How many vector-search results the reranker gets to choose from. The right
// section has to be somewhere in this list for the reranker to find it.
const RERANK_CANDIDATES = 10;

export async function retrieve(question: string, k = 3) {
  const [queryVector] = await embed([question], "query");

  const ranked = index
    .map((c) => ({
      section: c.section,
      text: c.text,
      score: cosine(queryVector, c.vector),
    }))
    .sort((a, b) => b.score - a.score);

  if (!RERANK) return ranked.slice(0, k);

  // Vector search casts a wider net, then the reranker reads the question with
  // each candidate and keeps the best k. Near-duplicate sections (Berlin or
  // part-time leave next to the general rules) look alike as vectors, but the
  // reranker can see that the question never mentions Berlin or part-time work.
  const candidates = ranked.slice(0, RERANK_CANDIDATES);
  const order = await rerank(question, candidates.map((c) => c.text), k);
  return order.map((r) => ({
    ...candidates[r.index],
    // The reranker's score replaces the cosine score, which is no longer what ranked it.
    score: r.score,
  }));
}
