import json
import os

import requests

from .retrieve import retrieve
from .tools import LEAVE_TOOL, TOOLS

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
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


def answer(question: str) -> dict:
    """Retrieve the top sections, ask the LLM (which may call tools), and return
    the answer, the chunks used and every tool call the model made."""
    chunks = retrieve(question)
    context = "\n\n---\n\n".join(c["text"] for c in chunks)

    # The conversation so far. Tool calls and their results get added to it.
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Handbook sections:\n\n{context}\n\nQuestion: {question}\n\n{REMINDER}",
        },
    ]
    # Every tool call the model made, so evals can check the arguments.
    tool_calls = []

    for _ in range(MAX_STEPS):
        res = requests.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
            json={
                "model": MODEL,
                # gpt-oss models think before answering, and thinking uses this budget.
                "max_tokens": 3000,
                # 0 = the same question gives (nearly) the same answer, so runs are comparable.
                "temperature": 0,
                "messages": messages,
                "tools": [LEAVE_TOOL],  # tells the model the tool exists
            },
            timeout=120,
        )
        if not res.ok:
            raise RuntimeError(f"Groq failed: {res.status_code} {res.text}")

        msg = res.json()["choices"][0]["message"]

        # No tool call means the model has written its answer.
        if not msg.get("tool_calls"):
            return {"answer": msg["content"], "chunks": chunks, "tool_calls": tool_calls}

        # The model wants a tool. Record its request, run the tool, and add the
        # result to the conversation so the next call can see it.
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": msg["tool_calls"]})

        for call in msg["tool_calls"]:
            name = call["function"]["name"]
            print("tool call:", name, call["function"]["arguments"])
            try:
                args = json.loads(call["function"]["arguments"])
            except json.JSONDecodeError:
                args = None
            tool_calls.append({"name": name, "args": args})

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
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})

    # The cap was reached without an answer.
    return {
        "answer": "Sorry, I could not work that out. Please ask HR or your manager.",
        "chunks": chunks,
        "tool_calls": tool_calls,
    }
