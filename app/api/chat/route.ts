import { answerStream } from "../../../lib/answer";
import { describeError, friendlyError } from "../../../lib/groq";

// lib/ reads files (the index, the logs), which needs Node, not the Edge runtime.
export const runtime = "nodejs";
// Every request is a new question, so never cache the response.
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 1000;

// POST { "question": "..." } and get back the answer as NDJSON: one JSON event
// per line, sent as soon as it happens.
//   {"type":"status","text":"Checking your leave balance..."}
//   {"type":"text","delta":"You have "}
//   {"type":"done"}
//   {"type":"error","message":"The assistant is busy right now..."}
export async function POST(req: Request) {
  let question: unknown;
  try {
    ({ question } = await req.json());
  } catch {
    // handled below
  }
  if (typeof question !== "string" || !question.trim()) {
    return Response.json({ error: "Send a question." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json({ error: "That question is too long." }, { status: 400 });
  }

  const events = answerStream(question.trim());
  const encoder = new TextEncoder();
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
        // which are for the log and evals, not the browser. Send only the signal.
        send(controller, value.type === "done" ? { type: "done" } : value);
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
