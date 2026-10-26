import fs from "fs";
import { embed } from "./embed";
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

export async function retrieve(question: string, k = 3) {
  const [queryVector] = await embed([question], "query");

  return index
    .map((c) => ({
      section: c.section,
      text: c.text,
      score: cosine(queryVector, c.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
