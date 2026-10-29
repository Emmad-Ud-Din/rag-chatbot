import { ApiError } from "./groq";

const URL = "https://api.voyageai.com/v1/rerank";
const MODEL = "rerank-2.5";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A reranker reads the question and each document together and scores how well
// the document answers it. That is slower than comparing two vectors, so it runs
// only on a short list of candidates that vector search already picked.
//
// Returns the indexes of the best `topK` documents (positions in `documents`),
// best first, with their relevance scores. `sleepFn` lets tests skip waiting.
export async function rerank(
  query: string,
  documents: string[],
  topK: number,
  sleepFn = sleep
): Promise<{ index: number; score: number }[]> {
  // Someone is waiting for the answer, so retry a rate limit briefly, like the
  // query embedding in embed.ts, and then give up with a "busy" error.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ query, documents, model: MODEL, top_k: topK }),
    });

    if (res.ok) {
      const json = await res.json();
      // The docs show the result items but not the key around them, so accept
      // both likely names and fail loudly if neither is there.
      const results = json.data ?? json.results;
      if (!Array.isArray(results)) {
        throw new ApiError("Voyage rerank", res.status, `unexpected response: ${JSON.stringify(json).slice(0, 200)}`, false, null);
      }
      return results.map((r: { index: number; relevance_score: number }) => ({
        index: r.index,
        score: r.relevance_score,
      }));
    }

    const detail = await res.text();
    const temporary = res.status === 429 || res.status >= 500;
    if (!temporary || attempt >= 3) {
      throw new ApiError("Voyage rerank", res.status, detail, temporary, temporary ? 60_000 : null);
    }
    console.error(`Voyage rerank ${res.status}, retrying in 2s`);
    await sleepFn(2000);
  }
}
