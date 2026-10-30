import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Turn } from "./rewrite";

export const MAX_HISTORY = 6;
const MAX_TURN_LENGTH = 4000;

// The secret the server signs its answers with. Only the server has it, so only
// the server can make a valid signature.
// - On Vercel it must be set (HISTORY_SECRET), or the chat refuses to sign,
//   the same "fail closed" rule as the rate limit.
// - Locally, without one, a random secret is made when the server starts.
//   Restarting the dev server then invalidates old answers, which only means
//   follow-ups lose their context.
let secret: string | undefined;
function getSecret(): string {
  if (secret) return secret;
  if (process.env.HISTORY_SECRET) {
    secret = process.env.HISTORY_SECRET;
  } else if (process.env.VERCEL) {
    throw new Error("HISTORY_SECRET is not set");
  } else {
    secret = randomBytes(32).toString("hex");
  }
  return secret;
}

// HMAC of the answer text: changes completely if one character changes, and
// cannot be made without the secret.
export function sign(text: string): string {
  return createHmac("sha256", getSecret()).update(text).digest("hex");
}

// Compares in constant time, so an attacker cannot guess a signature one
// character at a time by measuring how long the check takes.
function validSignature(text: string, sig: unknown): boolean {
  if (typeof sig !== "string") return false;
  const expected = Buffer.from(sign(text), "hex");
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The history comes from the browser, so check its shape before it reaches the
// model, and keep only what the bot would use anyway.
// Assistant messages must carry the signature the server sent with them. One
// without a valid signature (forged, or edited) is dropped, not rejected: after
// the secret changes, real conversations lose context instead of breaking.
// User messages are not signed: the employee writes those anyway.
export function cleanHistory(raw: unknown): Turn[] {
  // Checked even for an empty history, so a missing secret on Vercel stops the
  // request here, before the answer is written and can't be signed.
  getSecret();
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t) =>
        t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim() !== ""
    )
    .filter((t) => t.role === "user" || validSignature(t.content, t.sig))
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_TURN_LENGTH) }));
}
