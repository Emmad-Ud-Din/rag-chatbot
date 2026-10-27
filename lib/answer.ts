import { retrieve } from "./retrieve";

const SYSTEM_PROMPT = `You answer employee questions using only the handbook sections provided.

Rules:
- Use only the information in the sections. Do not use outside knowledge or guess.
- If the sections do not contain the answer, say clearly that the handbook does not cover it.
- If a section mentions something related to what the employee asked, always tell them about it, even when it is unclear whether it applies. Do not say the handbook does not mention a benefit when a section mentions a similar one. Example only, not handbook content: if asked "Can I expense a taxi to the airport?" and a section says "A transport allowance of 20 USD is available per trip", answer that there is a transport allowance of 20 USD per trip, but the handbook does not say whether airport taxis qualify.
- If the sections answer only part of the question, state what they do say, including any numbers, and then say what they do not cover.
- When the handbook does not cover something, suggest the employee ask HR or their manager.
- Keep answers short and direct.`;

export async function answer(question: string) {
  const chunks = await retrieve(question);
  const context = chunks.map((c) => c.text).join("\n\n---\n\n");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      // gpt-oss models think before answering, and thinking uses this budget.
      max_tokens: 1500,
      // 0 = the same question gives the same answer, so eval runs are comparable.
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          // The reminder sits next to the question on purpose: models weight the
          // last thing they read, and the system prompt rule alone was not enough.
          content: `Handbook sections:\n\n${context}\n\nQuestion: ${question}\n\nReminder: if any section mentions something related to the question, tell the employee about it, even if it is unclear whether it applies. If the sections fully answer the question, answer it and stop, without adding statements about what the handbook does not cover. A detail in the question only counts as a part the handbook does not cover if the answer would be different depending on what the handbook said about it. If they answer only part of it, give that part, then say clearly which part the handbook does not cover.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq failed: ${res.status} ${detail}`);
  }

  const json = await res.json();
  return { answer: json.choices[0].message.content as string, chunks };
}
