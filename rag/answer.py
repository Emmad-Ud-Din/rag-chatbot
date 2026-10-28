import json
import time
from datetime import datetime, timezone

from .groq import stream_groq
from .log import log_request, prompt_version
from .retrieve import retrieve
from .tools import LEAVE_TOOL, TOOLS

MODEL = "openai/gpt-oss-120b"

SYSTEM_PROMPT = """You answer employee questions using only the handbook sections provided.

Rules:
- Use only the information in the sections. Do not use outside knowledge or guess.
- If the sections do not contain the answer, say clearly that the handbook does not cover it.
- If a section mentions something related to what the employee asked, always tell them about it, even when it is unclear whether it applies. Do not say the handbook does not mention a benefit when a section mentions a similar one. Example only, not handbook content: if asked "Can I expense a taxi to the airport?" and a section says "A transport allowance of 20 USD is available per trip", answer that there is a transport allowance of 20 USD per trip, but the handbook does not say whether airport taxis qualify.
- If the sections answer only part of the question, state what they do say, including any numbers, and then say what they do not cover.
- When a benefit or rule has a condition, such as an approval, a deadline, a required document, or who is eligible, state the condition exactly, including when it must happen (for example "approved by a manager before the overtime is worked", not just "approved overtime").
- When deciding what the handbook does not cover, compare the employee's situation with what the policy covers, not the words in the question with the words in the handbook. Check who the policy applies to and when it starts and ends, and say clearly which part of the employee's situation falls outside it. Example only, not handbook content: if asked about leave during an adoption process and a policy covers leave "from the date the child joins the family", say that leave before that date is not covered.
- When the handbook does not cover something, suggest the employee ask HR or their manager.
- Only say the handbook does not cover something if the employee asked about exactly that. Do not comment on other topics the handbook might or might not cover.
- For questions about how many annual leave days an employee has left, use the calculate_leave tool. Do not do the date math or subtraction yourself.
- If a tool returns an error, do not guess new inputs. Tell the employee what information is missing and ask for it.
- Never mention tools to the employee. Present tool results as your own answer, for example "your carried-over days expired on March 31", not "the tool indicates".
- Keep answers short and direct."""

# The reminder sits next to the question on purpose: models weight the last
# thing they read, and the system prompt rule alone was not enough.
REMINDER = (
    "Reminder: if any section mentions something related to the question, "
    "tell the employee about it, even if it is unclear whether it applies. "
    "If the sections fully answer the question, answer it and stop, without adding "
    "statements about what the handbook does not cover. A detail in the question only "
    "counts as a part the handbook does not cover if the answer would be different "
    "depending on what the handbook said about it. If they answer only part of "
    "it, give that part, then say clearly which part the handbook does not cover."
)


# Stops the loop if the model keeps calling tools without ever answering.
MAX_STEPS = 3


# Changes whenever the prompt, the reminder or the tool description changes.
PROMPT_VERSION = prompt_version(SYSTEM_PROMPT, REMINDER, json.dumps(LEAVE_TOOL))


# What the employee sees while a tool runs, so they know what is happening.
TOOL_STATUS = {"calculate_leave": "Checking your leave balance..."}


def answer_stream(question: str):
    """Yield events as the request goes, in order:

        {"type": "status", "text": ...}   a short note while retrieval or a tool runs
        {"type": "text", "delta": ...}    the next piece of the answer, to add to what is shown
        {"type": "done", "result": ...}   answer, chunks and tool calls, for logs and evals

    Every request is logged, including ones that fail halfway (a 429 on step 2,
    say): the log entry is filled in as the request goes and written in `finally`,
    which also runs if the caller stops reading early.
    """
    started = time.monotonic()
    # Every tool call the model made, with its result, for evals and the log.
    tool_calls = []
    log = {
        "time": datetime.now(timezone.utc).isoformat(),
        "promptVersion": PROMPT_VERSION,
        "question": question,
        "toolCalls": tool_calls,
    }
    tokens = 0
    first_text_ms = None

    try:
        yield {"type": "status", "text": "Looking up the handbook..."}
        chunks = retrieve(question)
        log["sections"] = [{"section": c["section"], "score": round(c["score"], 3)} for c in chunks]
        context = "\n\n---\n\n".join(c["text"] for c in chunks)

        # The conversation so far. Tool calls and their results get added to it.
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Handbook sections:\n\n{context}\n\nQuestion: {question}\n\n{REMINDER}",
            },
        ]

        for _ in range(MAX_STEPS):
            # What this step's stream adds up to. Text is passed on as it arrives.
            # Tool calls arrive in pieces too (the arguments as fragments of a JSON
            # string), so they are collected and only parsed once the step is over.
            content = ""
            pending: dict[int, dict] = {}

            # stream_groq retries short rate limits before the stream starts, and
            # raises an ApiError for everything else (logged below, shown nicely by the caller).
            for chunk in stream_groq(
                {
                    "model": MODEL,
                    # gpt-oss models think before answering, and thinking uses this budget.
                    "max_tokens": 3000,
                    # 0 = the same question gives (nearly) the same answer, so runs are comparable.
                    "temperature": 0,
                    "messages": messages,
                    "tools": [LEAVE_TOOL],  # tells the model the tool exists
                }
            ):
                # Groq puts the token count on the last chunk, under x_groq.
                usage = chunk.get("usage") or (chunk.get("x_groq") or {}).get("usage")
                if usage:
                    tokens += usage.get("total_tokens", 0)

                choices = chunk.get("choices") or []
                delta = choices[0].get("delta") if choices else None
                if not delta:
                    continue

                if delta.get("content"):
                    content += delta["content"]
                    if first_text_ms is None:
                        first_text_ms = round((time.monotonic() - started) * 1000)
                    yield {"type": "text", "delta": delta["content"]}

                for piece in delta.get("tool_calls") or []:
                    # `index` says which tool call this piece belongs to; the first
                    # piece of each call carries its id and name.
                    call = pending.setdefault(piece["index"], {"id": "", "name": "", "args": ""})
                    if piece.get("id"):
                        call["id"] = piece["id"]
                    fn = piece.get("function") or {}
                    call["name"] += fn.get("name") or ""
                    call["args"] += fn.get("arguments") or ""

            # No tool call means the model has written its answer.
            if not pending:
                log["answer"] = content
                yield {"type": "done", "result": {"answer": content, "chunks": chunks, "tool_calls": tool_calls}}
                return

            # The model wants a tool. Record its request, run the tool, and add the
            # result to the conversation so the next call can see it.
            calls = [pending[i] for i in sorted(pending)]
            messages.append(
                {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": [
                        {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["args"]}}
                        for c in calls
                    ],
                }
            )

            for call in calls:
                name = call["name"]
                print("tool call:", name, call["args"])
                yield {"type": "status", "text": TOOL_STATUS.get(name, "Working on it...")}

                # Now the arguments string is complete, so it can be parsed.
                try:
                    args = json.loads(call["args"])
                except json.JSONDecodeError:
                    args = None

                if args is None:
                    result = {"error": "The arguments were not valid JSON."}
                elif name in TOOLS:
                    try:
                        result = TOOLS[name](args)
                    except (KeyError, TypeError, ValueError) as e:
                        # A missing or wrongly typed argument. Tell the model instead of crashing.
                        result = {"error": f"Bad arguments: {e}"}
                else:
                    result = {"error": f"Unknown tool: {name}"}
                tool_calls.append({"name": name, "args": args, "result": result})
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})

        # The cap was reached without an answer.
        fallback = "Sorry, I could not work that out. Please ask HR or your manager."
        log["answer"] = None
        log["stepCapReached"] = True
        yield {"type": "text", "delta": fallback}
        yield {"type": "done", "result": {"answer": fallback, "chunks": chunks, "tool_calls": tool_calls}}
    except Exception as e:
        log["error"] = str(e)
        raise  # still fail the request, but only after recording why
    finally:
        log["ms"] = round((time.monotonic() - started) * 1000)
        log["firstTextMs"] = first_text_ms  # time to first token, as the employee feels it
        log["tokens"] = tokens
        log_request(log)


def answer(question: str) -> dict:
    """The whole answer at once, for evals and scripts that don't stream."""
    for event in answer_stream(question):
        if event["type"] == "done":
            return event["result"]
    raise RuntimeError("answer_stream ended without a done event")
