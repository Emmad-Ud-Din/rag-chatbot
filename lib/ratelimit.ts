import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Limits on how much one visitor, and everyone together, can ask. Without them,
// a public link lets anyone use up the Groq daily allowance (about 70 tool
// questions) or run up the Voyage bill.
//
// The counts live in Upstash Redis, not in memory: on Vercel every request may
// run in a fresh copy of the function, and several copies run at once, so a
// counter in a variable would reset and could never add up across copies.
const PER_VISITOR = { questions: 10, window: "10 m" } as const;
const DAILY_TOTAL = 60; // stays under Groq's free daily tokens even if every question uses the tool

export type LimitResult = { ok: true } | { ok: false; message: string; retryAfterSec: number };

type Limiter = { limit: (key: string) => Promise<{ success: boolean; reset: number }> };

// Built once per function copy. The Vercel Upstash integration sets KV_REST_API_*,
// a manual Upstash setup uses UPSTASH_REDIS_REST_*, so both names are accepted.
function createLimiters(): { visitor: Limiter; daily: Limiter } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    visitor: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(PER_VISITOR.questions, PER_VISITOR.window),
      prefix: "rl:visitor",
    }),
    daily: new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(DAILY_TOTAL, "1 d"),
      prefix: "rl:daily",
    }),
  };
}

let limiters: ReturnType<typeof createLimiters> | undefined;

// `testLimiters` lets tests pass fakes instead of a real Redis.
export async function checkLimits(
  visitor: string,
  testLimiters?: { visitor: Limiter; daily: Limiter }
): Promise<LimitResult> {
  if (limiters === undefined) limiters = createLimiters();
  const active = testLimiters ?? limiters;

  if (!active) {
    // No Redis keys. Locally that is fine: it's your own laptop and your own quota.
    // On Vercel it means the setup is missing, and a public link with no limit is
    // exactly the risk this file exists for, so refuse instead.
    if (process.env.VERCEL) {
      console.error("Rate limiting is not configured: set the Upstash Redis keys in Vercel.");
      return { ok: false, message: "The assistant is not available right now.", retryAfterSec: 3600 };
    }
    return { ok: true };
  }

  const secondsUntil = (reset: number) => Math.max(1, Math.ceil((reset - Date.now()) / 1000));

  const mine = await active.visitor.limit(visitor);
  if (!mine.success) {
    const sec = secondsUntil(mine.reset);
    return {
      ok: false,
      message: `You've asked a lot of questions in a short time. Please try again in about ${Math.ceil(sec / 60)} minute${sec > 60 ? "s" : ""}.`,
      retryAfterSec: sec,
    };
  }

  const everyone = await active.daily.limit("all");
  if (!everyone.success) {
    return {
      ok: false,
      message: "The assistant has reached its limit for today. Please try again tomorrow.",
      retryAfterSec: secondsUntil(everyone.reset),
    };
  }

  return { ok: true };
}

// The visitor's IP address. On Vercel, x-forwarded-for is set by Vercel's own
// proxy; its first entry is the visitor. Locally there is no proxy.
export function visitorId(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
