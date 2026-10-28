import { retrieve } from "./retrieve";
import { calculateLeave, leaveTool } from "./tools";
import { logRequest, promptVersion } from "./log";
import { callGroq } from "./groq";

const SYSTEM_PROMPT = `You answer employee questions using only the handbook sections provided.

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
- Keep answers short and direct.`;

// The reminder sits next to the question on purpose: models weight the last
// thing they read, and the system prompt rule alone was not enough.
const REMINDER = "Reminder: if any section mentions something related to the question, tell the employee about it, even if it is unclear whether it applies. If the sections fully answer the question, answer it and stop, without adding statements about what the handbook does not cover. A detail in the question only counts as a part the handbook does not cover if the answer would be different depending on what the handbook said about it. If they answer only part of it, give that part, then say clearly which part the handbook does not cover.";

// Stops the loop if the model keeps calling tools without ever answering.
const MAX_STEPS = 3;

// Changes whenever the prompt, the reminder or the tool description changes.
const PROMPT_VERSION = promptVersion(SYSTEM_PROMPT, REMINDER, JSON.stringify(leaveTool));

export async function answer(question: string) {
  // Filled in as the request goes, and written in `finally`, so a request that
  // crashes halfway (a 429 on step 2, say) is logged with everything up to that point.
  const started = Date.now();
  const log: Record<string, unknown> = {
    time: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    question,
  };
  // Every tool call the model made, with its result, for evals and the log.
  const toolCalls: { name: string; args: any; result?: unknown }[] = [];
  log.toolCalls = toolCalls;
  let tokens = 0;

  try {
    const chunks = await retrieve(question);
    log.sections = chunks.map((c) => ({ section: c.section, score: Number(c.score.toFixed(3)) }));
    const context = chunks.map((c) => c.text).join("\n\n---\n\n");

    // The conversation so far. Tool calls and their results get added to it.
    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Handbook sections:\n\n${context}\n\nQuestion: ${question}\n\n${REMINDER}`,
      },
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
      // callGroq retries short rate limits and server errors, and throws a
      // ApiError for everything else (logged below, shown nicely by the caller).
      const json = await callGroq({
        model: "openai/gpt-oss-120b",
        max_tokens: 3000,
        temperature: 0,
        messages,
        tools: [leaveTool], // tells the model the tool exists
      });
      tokens += json.usage?.total_tokens ?? 0;
      const msg = json.choices[0].message;

      // No tool call means the model has written its answer.
      if (!msg.tool_calls?.length) {
        log.answer = msg.content;
        return { answer: msg.content as string, chunks, toolCalls };
      }

      // The model wants a tool. Record its request, run the tool, and add the
      // result to the conversation so the next call can see it.
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

      for (const call of msg.tool_calls) {
        console.log("tool call:", call.function.name, call.function.arguments);

        let args: any = null;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {}
        let result;
        if (args === null) {
          result = { error: "The arguments were not valid JSON." };
        } else if (call.function.name === "calculate_leave") {
          result = calculateLeave(args);
        } else {
          result = { error: `Unknown tool: ${call.function.name}` };
        }
        toolCalls.push({ name: call.function.name, args, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    } // end of the step loop

    // The cap was reached without an answer.
    log.answer = null;
    log.stepCapReached = true;
    return {
      answer: "Sorry, I could not work that out. Please ask HR or your manager.",
      chunks,
      toolCalls,
    };
  } catch (err) {
    log.error = String(err);
    throw err; // still fail the request, but only after recording why
  } finally {
    log.ms = Date.now() - started;
    log.tokens = tokens;
    logRequest(log);
  }
}
