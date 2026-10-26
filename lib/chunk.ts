import fs from "fs";

export type Chunk = { section: number; text: string };

export function loadChunks(): Chunk[] {
  const text = fs.readFileSync("data/handbook.md", "utf-8");
  return text
    .split(/\n(?=## )/)
    .filter((c) => c.startsWith("## "))
    .map((c) => {
      const section = parseInt(c.match(/^## (\d+)\./)![1]);
      return { section, text: c.trim() };
    });
}
