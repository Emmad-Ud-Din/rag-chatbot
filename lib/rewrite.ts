import { callGroq } from "./groq";

// One earlier message in the chat, as the page sends it.
export type Turn = { role: "user" | "assistant"; content: string };

// Retrieval only sees the text it is given. "what if i take 3 more" has no topic
// words, so on its own it finds the wrong sections. This turns a follow-up into a
// question that makes sense without the conversation, which is what retrieval
// searches with. Joining the earlier messages instead would drag the old topic
// along when the employee changes subject ("and what about sick days?").
export const REWRITE_PROMPT = `You rewrite an employee's latest chat message so it can be understood without the conversation before it.

Rules:
- Keep every detail from the conversation that the latest message depends on, such as dates, numbers of days, and which policy or type of leave is meant.
- If the latest message changes topic, rewrite only the new topic and leave out the old one.
- If the latest message already makes sense on its own, return it unchanged.
- Do not answer the question and do not add facts that are not in the conversation.
- Reply with only the rewritten question, nothing else.`;

export async function rewriteQuestion(history: Turn[], question: string): Promise<string> {
  const transcript = history
    .map((t) => `${t.role === "user" ? "Employee" : "Assistant"}: ${t.content}`)
    .join("\n\n");

  const json = await callGroq({
    model: "openai/gpt-oss-120b",
    // Rewriting one sentence is a much easier job than answering from the
    // handbook, so less thinking is enough and the employee waits less.
    reasoning_effort: "low",
    max_tokens: 1000,
    temperature: 0,
    messages: [
      { role: "system", content: REWRITE_PROMPT },
      {
        role: "user",
        content: `Conversation so far:\n\n${transcript}\n\nLatest message: ${question}`,
      },
    ],
  });

  const rewritten = (json.choices?.[0]?.message?.content ?? "").trim();
  // If the rewrite comes back empty (it ran out of tokens, say), fall back to
  // the original question rather than searching for nothing.
  return rewritten || question;
}
