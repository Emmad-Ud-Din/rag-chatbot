const URL = "https://api.voyageai.com/v1/embeddings";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Text in, vectors out. Chunks and questions must use the SAME model.
// "document" is for stored passages, "query" is for user questions.
export async function embed(
  texts: string[],
  type: "document" | "query"
): Promise<number[][]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input: texts,
        model: "voyage-3.5",
        input_type: type,
      }),
    });

    // Rate limited: wait and retry (capped at 4 attempts).
    if (res.status === 429) {
      await sleep(21000);
      continue;
    }

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Embedding failed: ${res.status} ${detail}`);
    }

    const json = await res.json();
    return json.data.map((d: { embedding: number[] }) => d.embedding);
  }

  throw new Error("Embedding failed: still rate limited after retries");
}
