const JUDGE_PROMPT = `You grade answers from an employee handbook chatbot.
You are given a question, its type, a reference, the handbook sections the system retrieved, and the system's answer.
The reference is not handbook text. It is either the correct answer, or, for partial and unanswerable questions, a description of the correct behavior.

Rules by question type:

answerable:
- CORRECT only if the answer matches the reference in meaning. Different wording is fine.
- It must include the facts needed to answer the question correctly, such as the number and any condition that changes it. Extra context in the reference that the question did not ask about is optional.
- INCORRECT if a needed fact is missing or wrong, or if the answer contradicts the reference.

partial:
- CORRECT only if the answer gives the information described in the reference AND says clearly that the handbook does not cover the rest.
- INCORRECT if it guesses at the missing part or presents a guess as policy.

unanswerable:
- CORRECT only if the answer says the handbook does not cover the question and invents no policy.
- It may mention a related rule only if it says that rule is about a different situation.
- INCORRECT if it presents any rule, number, deadline, or procedure as the answer.

For all types:
- A detail that is not in the reference is fine if it appears in the handbook sections provided. It is INCORRECT only if the detail appears in neither the reference nor the sections.
- Suggesting the employee ask HR or their manager is fine.

Reply format: the first word must be exactly CORRECT or INCORRECT, followed by one or two sentences explaining why.`;

export async function judge(
  item: { question: string; reference: string; type: string },
  answer: string,
  sources: string
) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      max_tokens: 1500,
      // 0 = same input gives the same verdict, so runs are comparable.
      temperature: 0,
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        {
          role: "user",
          content:
            `Question: ${item.question}\n` +
            `Question type: ${item.type}\n` +
            `Reference: ${item.reference}\n` +
            `Handbook sections the system retrieved:\n${sources}\n\n` +
            `System answer: ${answer}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Judge failed: ${res.status} ${detail}`);
  }

  const json = await res.json();
  const text = json.choices[0].message.content as string;
  return { pass: text.trim().toUpperCase().startsWith("CORRECT"), reason: text };
}
