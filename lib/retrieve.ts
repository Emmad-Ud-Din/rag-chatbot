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

// Reranking is on by default: on the near-duplicate sections (contractors,
// part-time, Berlin next to the general rules) it took the eval questions that
// depend on them from 0/4 to 4/4 correct answers, for about 1 second more before
// the first word. RERANK=0 turns it off, to compare in experiments.
export const RERANK = process.env.RERANK !== "0";
// How many vector-search results the reranker gets to choose from. The right
// section has to be somewhere in this list for the reranker to find it.
const RERANK_CANDIDATES = 10;

export type RetrievalMode = "vector" | "vector+rerank" | "vector (rerank failed)";

// The top k chunks plus how they were picked, for the log.
export async function retrieveWithInfo(question: string, k = 3) {
  const [queryVector] = await embed([question], "query");

  const ranked = index
    .map((c) => ({
      section: c.section,
      text: c.text,
      score: cosine(queryVector, c.vector),
    }))
    .sort((a, b) => b.score - a.score);

  if (!RERANK) {
    return { chunks: ranked.slice(0, k), mode: "vector" as RetrievalMode, error: null };
  }

  // Vector search casts a wider net, then the reranker reads the question with
  // each candidate and keeps the best k. Near-duplicate sections look alike as
  // vectors, but the reranker can see that the question never mentions Berlin
  // or part-time work.
  const candidates = ranked.slice(0, RERANK_CANDIDATES);
  try {
    const order = await rerank(question, candidates.map((c) => c.text), k);
    return {
      chunks: order.map((r) => ({
        ...candidates[r.index],
        // The reranker's score replaces the cosine score, which is no longer what ranked it.
        score: r.score,
      })),
      mode: "vector+rerank" as RetrievalMode,
      error: null,
    };
  } catch (err) {
    // The reranker is an improvement, not a requirement: vector search alone got
    // most questions right. If it fails, answer with the vector order instead of
    // failing the whole request, and record why in the log.
    console.error("Rerank failed, using vector order:", String(err));
    return {
      chunks: candidates.slice(0, k),
      mode: "vector (rerank failed)" as RetrievalMode,
      error: String(err),
    };
  }
}

// Just the chunks, for scripts that don't need to know how they were picked.
export async function retrieve(question: string, k = 3) {
  return (await retrieveWithInfo(question, k)).chunks;
}
