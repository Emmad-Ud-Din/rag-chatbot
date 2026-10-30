"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
  status?: string; // shown in grey while the answer has not started yet
  error?: boolean;
  sig?: string; // the server's signature of this answer, sent back with it as history
};

const SUGGESTIONS = [
  "How many sick days do I get?",
  "Can I work from home every day?",
  "I joined on 2020-03-01 and used 8 days of annual leave. How many are left?",
];

// Answers use a little Markdown (**bold** and "- " lists). Render just those,
// as React elements, so model output is never inserted as raw HTML.
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

function renderAnswer(text: string) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      list.push(bullet[1]);
    } else {
      flushList();
      if (line.trim()) blocks.push(<p key={blocks.length}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return blocks;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as text streams in.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Change the last message (the assistant's answer that is streaming in).
  const updateLast = (change: (m: Message) => Message) =>
    setMessages((all) => [...all.slice(0, -1), change(all[all.length - 1])]);

  async function ask(question: string) {
    question = question.trim();
    if (!question || busy) return;
    setBusy(true);
    setInput("");
    // The conversation so far, so the bot can understand follow-ups like
    // "what if I take 3 more". Failed answers and empty ones are left out.
    // Answers go back with the signature the server gave them; the server drops
    // any answer whose signature does not match, so a forged one never reaches the model.
    const history = messages
      .filter((m) => m.text && !m.error)
      .map((m) => (m.role === "assistant" ? { role: m.role, content: m.text, sig: m.sig } : { role: m.role, content: m.text }));
    setMessages((all) => [
      ...all,
      { role: "user", text: question },
      { role: "assistant", text: "", status: "Sending" },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong. Please try again.");
      }

      // The answer arrives as NDJSON: one JSON event per line. A line can be
      // split across two network reads, so keep the unfinished end in `buffer`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "status") {
            // Strip a trailing "..." because the CSS animates the dots.
            updateLast((m) => ({ ...m, status: event.text.replace(/\.+$/, "") }));
          } else if (event.type === "text") {
            updateLast((m) => ({ ...m, text: m.text + event.delta, status: undefined }));
          } else if (event.type === "error") {
            updateLast((m) => ({ ...m, text: event.message, status: undefined, error: true }));
          } else if (event.type === "done") {
            updateLast((m) => ({ ...m, status: undefined, sig: event.sig }));
          }
        }
      }
    } catch (err) {
      updateLast((m) => ({
        ...m,
        text: err instanceof Error ? err.message : "Something went wrong. Please try again.",
        status: undefined,
        error: true,
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat">
      <header className="chat-header">
        <h1>Handbook Assistant</h1>
        <p>Answers come from the Northwind Labs employee handbook.</p>
      </header>

      <div className="messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="empty">
            <p>Ask about leave, remote work, travel, equipment and other policies.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}${m.error ? " error" : ""}`}>
            {m.role === "user" ? (
              m.text
            ) : m.status && !m.text ? (
              <span className="status">{m.status}</span>
            ) : (
              renderAnswer(m.text)
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter adds a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          placeholder="Ask about the handbook"
          rows={1}
          maxLength={1000}
          aria-label="Your question"
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
      <p className="note">Questions are kept for 30 days to improve the assistant.</p>
    </main>
  );
}
