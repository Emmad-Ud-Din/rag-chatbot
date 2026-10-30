import { answerStream } from "../../../lib/answer";
import { cleanHistory, sign } from "../../../lib/history";
import { describeError, friendlyError } from "../../../lib/groq";
import { checkLimits, visitorId } from "../../../lib/ratelimit";

// lib/ reads files (the index, the logs), which needs Node, not the Edge runtime.
export const runtime = "nodejs";
// Every request is a new question, so never cache the response.
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 1000;

// POST { "question": "...", "history": [{ "role": "user", "content": "..." }, ...] }
// (history is optional, oldest first) and get back the answer as NDJSON: one JSON event
// per line, sent as soon as it happens. Assistant messages in the history must carry
// the "sig" the server sent with them in the done event, or they are dropped.
//   {"type":"status","text":"Checking your leave balance..."}
//   {"type":"text","delta":"You have "}
//   {"type":"done","sig":"a91f..."}
//   {"type":"error","message":"The assistant is busy right now..."}
export async function POST(req: Request) {
  let question: unknown;
  let history: unknown;
  try {
    ({ question, history } = await req.json());
  } catch {
    // handled below
  }
  if (typeof question !== "string" || !question.trim()) {
    return Response.json({ error: "Send a question." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json({ error: "That question is too long." }, { status: 400 });
  }

  // Checked after the cheap validation above, so a malformed request does not
  // use up the visitor's allowance, and before any paid API call.
  const limit = await checkLimits(visitorId(req));
  if (!limit.ok) {
    return Response.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  // Throws only on Vercel without HISTORY_SECRET: refuse rather than accept
  // unchecked history, the same rule as the rate limit.
  let checkedHistory;
  try {
    checkedHistory = cleanHistory(history);
  } catch (err) {
    console.error(describeError(err));
    return Response.json({ error: "The assistant is not set up correctly." }, { status: 500 });
  }

  const events = answerStream(question.trim(), checkedHistory);
  const encoder = new TextEncoder();
  // Everything the page shows as the answer, so the signature covers exactly the
  // text the page will send back. (result.answer can be shorter: it leaves out
  // any text the model wrote before a tool call.)
  let shown = "";
  const send = (controller: ReadableStreamDefaultController, event: object) =>
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

  const stream = new ReadableStream({
    // Called whenever the browser is ready for more: pass on the next event.
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        // The done event carries the retrieved handbook text and the tool calls,
        // which are for the log and evals, not the browser. Send only the signal,
        // plus the signature of the full answer, which the page sends back with
        // this answer in the next request's history.
        if (value.type === "text") shown += value.delta;
        send(controller, value.type === "done" ? { type: "done", sig: sign(shown) } : value);
      } catch (err) {
        // answerStream has already logged the error. The browser gets the
        // friendly version; the real one goes to the server console.
        console.error(describeError(err));
        send(controller, { type: "error", message: friendlyError(err) });
        controller.close();
      }
    },
    // The employee closed the page or stopped the request. Stop the generator,
    // which runs its `finally`, so the half-finished request is still logged.
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Ask proxies not to hold the response back until it is complete.
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
