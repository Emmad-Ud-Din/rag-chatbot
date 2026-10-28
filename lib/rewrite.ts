import { callGroq } from "./groq";

// One earlier message in the chat, as the page sends it.
export type Turn = { role: "user" | "assistant"; content: string };

// Retrieval only sees the text it is given. "what if i take 3 more" has no topic
// words, so on its own it finds the wrong sections. This turns a follow-up into a
// question that makes sense without the conversation, which is what retrieval
// searches with. Joining the earlier messages instead would drag the old topic
// along when the employee changes subject ("and what about sick days?").
export const REWRITE_PROMPT = `You rewrite an employee's latest chat message so it can be understood without the conversation before it.

The rewritten question is used to search the employee handbook and is then answered by an assistant that may need to calculate things. Write it so that someone who has not seen the conversation could answer it from scratch.

Rules:
- Include every fact from the conversation needed to answer the question from scratch. Do not rely on earlier answers: if an earlier answer said "17 days left", include the facts that produced it (such as the join date and the days already used), not the result.
- For a "what if" question, combine the earlier facts with the new ones, for example days already used plus the extra days.
- Leave out facts the new question does not need. If the latest message changes topic, rewrite only the new topic.
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
