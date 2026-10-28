import crypto from "crypto";
import fs from "fs";

// One JSON object per request, one per line ("JSON Lines"). Each line is
// complete on its own, so the file can be searched or loaded by a script.
// The file holds employees' questions, so it is kept out of git.
const LOG_FILE = "logs/requests.jsonl";

// A short fingerprint of the prompt text. It changes whenever the prompt
// changes, so every log line shows which prompt produced it, without needing git.
export function promptVersion(...parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 8);
}

export function logRequest(entry: object) {
  try {
    fs.mkdirSync("logs", { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    // A full disk or a locked file must not break the answer itself.
    console.error("Could not write log:", err);
  }
}
