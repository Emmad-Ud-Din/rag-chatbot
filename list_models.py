"""List the model ids your Groq key can use. Handy when a model name returns 404."""

import os

import requests

import rag  # noqa: F401  (loads .env.local)


def main() -> None:
    res = requests.get(
        "https://api.groq.com/openai/v1/models",
        headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
        timeout=60,
    )
    if not res.ok:
        raise RuntimeError(f"List failed: {res.status_code} {res.text}")
    for m in res.json()["data"]:
        print(m["id"])


if __name__ == "__main__":
    main()
