import { ApiError } from "./groq";

const URL = "https://api.voyageai.com/v1/embeddings";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// How long to keep trying on a 429 depends on who is waiting.
// "query": a person asked a question and is looking at a spinner, so give up
// after a few seconds and let the chat say "busy". "document": ingest, a
// one-off job nobody watches, where waiting is fine and giving up means starting over.
const RETRY_RULES = {
  query: { attempts: 3, waitMs: 2000 },
  document: { attempts: 4, waitMs: 21000 },
};

// Text in, vectors out. Chunks and questions must use the SAME model.
// "document" is for stored passages, "query" is for user questions.
// `sleepFn` is a parameter so tests can skip the real waiting.
export async function embed(
  texts: string[],
  type: "document" | "query",
  sleepFn = sleep
): Promise<number[][]> {
  const rules = RETRY_RULES[type];

  for (let attempt = 1; ; attempt++) {
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

    if (res.ok) {
      const json = await res.json();
      return json.data.map((d: { embedding: number[] }) => d.embedding);
    }

    const detail = await res.text();
    const temporary = res.status === 429 || res.status >= 500;

    // Only temporary errors are worth another try, and only up to the limit.
    if (!temporary || attempt >= rules.attempts) {
      throw new ApiError("Voyage", res.status, detail, temporary, temporary ? 60_000 : null);
    }
    console.error(`Voyage ${res.status}, retrying in ${rules.waitMs / 1000}s`);
    await sleepFn(rules.waitMs);
  }
}
