// One place for calling Groq, with retries, used by both the bot and the judge.
//
// Retry only temporary errors (429 rate limit, 5xx server problems), and only
// when the wait is short. A 400 or 401 fails the same way every time, so it is
// not retried. A long wait (the daily token cap says "try again in 2m23s") is not
// worth making someone stare at a spinner for, so it fails fast instead.

const URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Thrown when an API call fails (Groq here, Voyage in embed.ts). `temporary`
// tells the caller whether trying again later could work, so the chat UI can
// show "busy, try again" instead of "something went wrong".
export class ApiError extends Error {
  constructor(
    public service: string,
    public status: number,
    public detail: string,
    public temporary: boolean,
    public retryAfterMs: number | null
  ) {
    super(`${service} failed: ${status} ${detail}`);
  }
}

// Groq sends `retry-after` in seconds. Its error text also says
// "Please try again in 2m23.856s", which is used when the header is missing.
function waitFromResponse(res: Response, detail: string): number | null {
  const header = Number(res.headers.get("retry-after"));
  if (header > 0) return header * 1000;
  const m = detail.match(/try again in (?:(\d+)m)?([\d.]+)s/);
  if (m) return (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000;
  return null;
}

// Sends the request and retries temporary errors. Returns the response once it
// is OK, so callGroq can read it whole and streamGroq can read it piece by piece.
// `sleepFn` is a parameter so tests can skip the real waiting.
async function postWithRetries(body: object, sleepFn = sleep): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return res;

    const detail = await res.text();
    const temporary = res.status === 429 || res.status >= 500;
    // Use Groq's own wait if it gave one, otherwise back off: 1s, then 2s.
    const waitMs = waitFromResponse(res, detail) ?? 1000 * 2 ** attempt;

    if (!temporary || attempt >= MAX_RETRIES || waitMs > MAX_WAIT_MS) {
      throw new ApiError("Groq", res.status, detail, temporary, temporary ? waitMs : null);
    }
    console.error(`Groq ${res.status}, retrying in ${Math.round(waitMs / 1000)}s`);
    await sleepFn(waitMs);
  }
}

// The whole reply at once. Used by the judge, which has nobody waiting on it.
export async function callGroq(body: object, sleepFn = sleep) {
  const res = await postWithRetries(body, sleepFn);
  return res.json();
}

// The reply in pieces, as the model writes it. Groq sends Server-Sent Events:
// lines like `data: {...}`, ending with `data: [DONE]`. Each yielded value is one
// parsed chunk, with the new text in `choices[0].delta`.
//
// Retries only happen before the stream starts. Once text is on the employee's
// screen, a failure can't be retried silently, so it is thrown instead.
export async function* streamGroq(body: object, sleepFn = sleep): AsyncGenerator<any> {
  const res = await postWithRetries({ ...body, stream: true }, sleepFn);
  if (!res.body) throw new ApiError("Groq", res.status, "empty stream", true, null);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // Network reads don't line up with lines: one `data:` line can arrive split
  // across two reads. Keep the unfinished end of the text until the rest comes.
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // the last piece may be an unfinished line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue; // blank lines and comments
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      yield JSON.parse(data);
    }
  }
}

// What to show the employee when a request failed. Lives here so every
// interface (terminal script now, chat UI later) says the same thing.
export function friendlyError(err: unknown) {
  if (err instanceof ApiError && err.temporary) {
    const minutes = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 60_000) : 1;
    return `The assistant is busy right now. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return "Something went wrong on our side. Please try again later, or ask HR or your manager.";
}
