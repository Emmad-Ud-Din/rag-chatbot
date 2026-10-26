// Lists the model ids your Groq key can use. Handy when a model name 404s.
async function main() {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`List failed: ${res.status} ${detail}`);
  }

  const json = await res.json();
  for (const m of json.data) console.log(m.id);
}

main();
