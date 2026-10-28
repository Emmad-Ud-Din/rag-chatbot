import crypto from "crypto";
import fs from "fs";
import path from "path";

// One JSON object per request, one per line ("JSON Lines"), in one file per day:
// logs/2026-10-28.jsonl. Each line is complete on its own, so the files can be
// searched or loaded by a script.
//
// The logs hold employees' questions, which can include health and other
// personal details, so they are kept out of git and deleted after RETENTION_DAYS.
const LOG_DIR = "logs";
const RETENTION_DAYS = 30;

// A short fingerprint of the prompt text. It changes whenever the prompt
// changes, so every log line shows which prompt produced it, without needing git.
export function promptVersion(...parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 8);
}

// "2026-10-28" for a given time, in UTC, the same as the `time` field in each line.
function dayOf(time: Date) {
  return time.toISOString().slice(0, 10);
}

// Deletes day files older than RETENTION_DAYS. `now` is a parameter so tests
// can fix the date, like calculateLeave's `today`.
export function deleteOldLogs(now: Date = new Date()) {
  if (!fs.existsSync(LOG_DIR)) return;
  const cutoff = dayOf(new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
  for (const file of fs.readdirSync(LOG_DIR)) {
    const match = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
    // Dates in YYYY-MM-DD form sort correctly as text, so < compares them as dates.
    if (match && match[1] < cutoff) {
      fs.unlinkSync(path.join(LOG_DIR, file));
    }
  }
}

let cleanedToday = "";

export function logRequest(entry: object, now: Date = new Date()) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Clean up once per day per process, not on every request.
    const today = dayOf(now);
    if (cleanedToday !== today) {
      deleteOldLogs(now);
      cleanedToday = today;
    }
    fs.appendFileSync(path.join(LOG_DIR, `${today}.jsonl`), JSON.stringify(entry) + "\n");
  } catch (err) {
    // A full disk or a locked file must not break the answer itself.
    console.error("Could not write log:", err);
  }
}
