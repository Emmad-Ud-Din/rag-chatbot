import { retrieve } from "./retrieve";

const SYSTEM_PROMPT = `You answer employee questions using only the handbook sections provided.

Rules:
- Use only the information in the sections. Do not use outside knowledge or guess.
- If the sections do not contain the answer, say clearly that the handbook does not cover it.
- If a section covers a related but different situation, you may mention it, but say it is a different situation and not the answer.
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
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Handbook sections:\n\n${context}\n\nQuestion: ${question}`,
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
