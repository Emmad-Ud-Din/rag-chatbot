import fs from "fs";
import { loadChunks } from "../lib/chunk";
import { embed } from "../lib/embed";

// Run once (and again whenever the handbook or embedding model changes).
async function main() {
  const chunks = loadChunks();
  const vectors = await embed(chunks.map((c) => c.text), "document");

  const index = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));

  fs.writeFileSync("data/index.json", JSON.stringify(index));
  console.log(`Saved ${index.length} chunks`);
}

main();
