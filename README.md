# Handbook Assistant

A chatbot that answers employee questions from a company handbook. I built it to learn AI engineering end to end: retrieval, evals, tool use, and running it in production. The handbook is fictional (Northwind Labs).

**Live demo:** https://rag-chatbot-eosin-eight.vercel.app/

Try "How many sick days do I get?", or "I joined on 2020-03-01 and used 8 days of annual leave. How many are left?" followed by "what if I take 3 more". Each visitor can ask 10 questions every 10 minutes.

**Stack:** Next.js 15, TypeScript, Groq (`gpt-oss-120b`), Voyage AI embeddings, Upstash Redis, Vercel. A Python version of the core is on the `python-vers` branch.

## What it does

- **Retrieval:** the handbook is split per section, embedded with Voyage, and the top 3 sections are picked by cosine similarity. No vector database: 14 chunks fit in memory.
- **Answers** come from Groq and stream into a Next.js chat page, with status lines ("Checking your leave balance...") while it works.
- **A leave calculator tool** does the date math and arithmetic. The model has no clock, so it calls the tool instead of guessing today's date.
- **Follow-up questions:** a rewrite step turns "what if I take 3 more" into a full question before searching the handbook.
- **Evals:** 21 handbook questions graded by an LLM judge, separate retrieval and answer scores, tool-argument checks, and unit tests for the calculator.
- **Production basics:** request logs, retries with backoff, streaming, rate limiting, and friendly error messages.

## What the evals taught me

- **A score can hide a lot.** Lowering the model's reasoning effort cost one point (20/21 to 19/21), but reading the answers showed five got worse, including a bug I had already fixed coming back.
- **A right answer can come from the wrong process.** On a follow-up question the bot answered "14 days" correctly while skipping the calculator and doing the math itself. Only a check on the tool arguments caught it, and that shortcut breaks as soon as dates matter.
- **The judge needs testing too.** The LLM judge passed and failed the same flawed answer on different runs. Giving it the full handbook, making it write one check line per claim, and combining those checks in code made it more consistent, though not perfectly. Judgment calls like "does this detail matter?" stayed unreliable, so those go to a regex flag and a human look instead.
- **Some failures were in the tests, not the bot.** One test case had sloppy wording, and one date check broke on a look-alike hyphen. New tests were made to fail first, so I knew they could catch the problem they were written for.
- **Change one thing at a time.** Some fixes looked right and changed nothing (more reasoning effort on the rewrite step), and one rule in the wrong place made a question worse (0 of 3 runs). Each change was measured on its own and reverted when it did not help.
- **Serverless changes where state can live.** Log files, an in-memory rate limit counter and a gitignored index all break on Vercel. They moved to the console, Redis and git.

The sections below are the working notes: how each part works, every eval run, and the known weak spots.

## How it works

**Once, ahead of time (`npm run ingest`)**
1. Split `data/handbook.md` into chunks, one per `## ` section.
2. Embed each chunk with Voyage AI.
3. Save text, section number and vector to `data/index.json`.

**For every question**
1. Embed the question with the same model (`input_type: "query"`).
2. Score it against every chunk with cosine similarity and keep the top 3.
3. Send the question and those chunks to the LLM (Groq, `openai/gpt-oss-120b`), with instructions to answer only from the sections and to say so when the handbook does not cover something.
4. If the question is about remaining annual leave, the model can call the `calculate_leave` tool instead of doing the math itself (see "Agent step" below).

There is no vector database. With 14 chunks, a list in memory and a loop is enough.

## Agent step: the leave calculator

"I joined on 2020-03-01 and used 8 days, how many are left?" needs today's date and arithmetic. The model has no clock, and it guesses the date from its training data, so the date math and subtraction live in code (`lib/tools.ts`):

- **Split of work:** the model reads the employee's numbers from the question and the rule numbers (20, 25, 5 years, max 5 carried over, expiry 03-31) from the retrieved handbook section, and passes them in. The code applies the rules. Keeping the rule numbers as inputs means the handbook stays the single source of truth.
- **Input checks:** a bad date, a date that does not exist (2020-02-30), a future join date or negative days return an error message to the model instead of throwing, so the model can ask the employee for what is missing. JavaScript does not throw on a bad date, it returns `Invalid Date` and the math silently gives a wrong number.
- **Results the model can explain:** the tool returns the intermediate facts (days claimed, allowed after the maximum, counted after expiry), not only `remaining`. Without them the model sometimes said "you carried over 7, so none count", which is not the rule.
- **The loop** (`lib/answer.ts`): call the model with the tool, run any tool calls, add the results to the conversation, repeat. `MAX_STEPS = 3` stops a model that keeps calling the tool, since every step resends the whole conversation and uses tokens.

Testing it, in two parts:
- `npm run test:tools`: unit tests for the calculator with a fixed "today", so results never change with the calendar. They include boundaries (the day before and on the 5th anniversary, 31 March and 1 April). Changing `>=` to `>` in the allowance check fails only the anniversary test, which shows the boundary tests are needed.
- `npm run evals:tools` (`data/tool-evals.json`): checks the model's tool arguments exactly, and that it does not call the tool when it should not (a sick leave question, a vague join date). No judge. The final number depends on today's date, the arguments do not.

What the tool evals caught:
- The model asked the employee for "the current year" instead of calling the tool. Fixed by saying in the tool description that it knows today's date.
- For "I carried over 7 days" (over the 5-day maximum) the model skipped the tool 3 of 3 times and did the math itself. It got the right number by assuming the year is 2026, which would be wrong next March. A check of the final answer alone would have passed it. Fixed by saying in the `carriedOver` description to pass exactly what the employee said and that the tool applies the maximum (then 5 of 6 runs called the tool).

Open: first-year proration ("an employee who joins mid-year receives a prorated amount") is not handled, and "leave accrues monthly" is ambiguous (only the first year, or everyone builds up leave month by month?), so it needs an answer from HR before the tool can handle it.

## Chat page

```
npm install
npm run ingest     # once, builds data/index.json
npm run dev        # then open http://localhost:3000
```

On Windows behind a proxy or antivirus, set `NODE_USE_SYSTEM_CA=1` first, as for the scripts. Next.js reads the keys from `.env.local` by itself.

- `app/api/chat/route.ts` takes `{ "question": "...", "history": [...] }` and sends `answerStream()` events back as NDJSON, one JSON event per line, as soon as each happens. The `done` event reaches the browser without the retrieved text or tool calls, which stay in the server log. Errors become `{ "type": "error" }` with the friendly message. If the employee closes the page mid-answer, the stream is cancelled and the request is still logged.
- `package.json` has an `overrides` entry for `postcss`. Next.js 15 bundles PostCSS 8.4.31, which `npm audit` flags (XSS and file-read issues that need attacker-controlled CSS; this project only processes its own `globals.css`). The override swaps in a fixed 8.5.x without moving to Next.js 16. Remove it after upgrading Next.js.
- `app/page.tsx` shows status lines while waiting, adds each text piece as it arrives, and renders the bold text and lists the model writes as React elements, never as raw HTML. It tells employees that questions are kept for 30 days.

## Follow-up questions

The page sends the conversation so far with each question, and the route keeps the last 6 messages. The model sees those turns before the new question, so it knows what "what if I take 3 more" refers to.

Retrieval needs more. Embedding "what if I take 3 more" on its own finds the wrong sections, and joining it with the earlier messages drags the old topic along when the employee changes subject ("and what about sick days?"). So `lib/rewrite.ts` first rewrites a follow-up into a question that stands on its own, and retrieval searches with that. The rewrite is a separate call with `reasoning_effort: "low"`, which is fine for this simple task even though it hurt answer quality. The first message in a chat skips it. The log records `rewrittenQuestion` and `historyLength`.

Tool evals T5 and T6 are follow-ups:
- T5 ("what if i take 3 more") checks that the rewrite keeps the join date and the 8 days, and that the tool gets `daysUsed: 11`.
- T6 ("and what about sick days?") checks that the rewrite drops the annual leave topic and that the tool is not called.

The first live run of T5 gave the right answer (14 days) but failed both checks: the rewrite lost the details, and the model subtracted 17 - 3 itself. Fixes, one at a time:
- `reasoning_effort: "medium"` on the rewrite changed nothing, so it was reverted.
- Telling the rewriter who reads its output (a system that has not seen the conversation), and not to rely on earlier answers, made it keep the join date and the 8 days.
- A sentence at the end of the reminder ("call calculate_leave ... even if an earlier answer already gave a number") raised tool use on T5 from 0/5 to 5/8.

The answer was 14 every time, so only the tool eval tells these runs apart. Skipping the tool matters when dates do (carry-over expiry, anniversaries). A regression check (tool evals 1-4 and 6, evals 7, 10 and 19) showed no new failures.

## Deploying to Vercel

Some things that work on a laptop don't on serverless hosting, where each request may run in a fresh, short-lived copy of the function with a read-only file system:

- **`data/index.json` is committed.** Vercel builds from git, and without it the build fails (Next.js loads the route while building, and `retrieve.ts` reads the file right away). It holds only the handbook text and vectors. After changing the handbook or the embedding model, run `npm run ingest` and commit the new file. `next.config.ts` lists it so Vercel packages it with the chat route.
- **Logs go to the console on Vercel** (`VERCEL` is set by Vercel), where they show up in Vercel's logs view, kept only a short time on the free plan. Locally they still go to `logs/`.
- **API keys** go in the Vercel project's Settings → Environment Variables, never in git.
- **Rate limiting** (`lib/ratelimit.ts`): 10 questions per visitor (by IP) per 10 minutes, and 60 a day for everyone, which keeps a public link from using up the Groq daily allowance or running up the Voyage bill. The counts live in Upstash Redis, because a counter in memory would reset with every new function copy and could not add up across copies running at once. On Vercel without the Redis keys, the chat refuses requests instead of running unlimited. Locally, without keys, there is no limit.
- Set a spending limit in the Voyage dashboard as a final backstop.

Environment variables on Vercel: `GROQ_API_KEY`, `VOYAGE_API_KEY`, and the Upstash pair (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or the `KV_REST_API_URL` and `KV_REST_API_TOKEN` the Vercel integration creates).

## Project layout

```
data/
  handbook.md      the sample handbook (14 sections)
  evals.json       21 test questions with reference answers
  tool-evals.json  questions with the tool arguments the model should pass
  index.json       generated by ingest, committed so Vercel has it
app/
  page.tsx         the chat page
  api/chat/route.ts streams answer events to the page
lib/
  chunk.ts         handbook -> chunks
  embed.ts         text -> vectors (Voyage), with retry on 429
  retrieve.ts      question -> top k chunks
  answer.ts        chunks + question -> LLM (with tool loop) -> answer
  tools.ts         leave calculator and its schema for the model
  rewrite.ts       turns a follow-up into a standalone question for retrieval
  ratelimit.ts     per-visitor and daily limits, stored in Upstash Redis
  log.ts           one JSON line per request in logs/YYYY-MM-DD.jsonl, kept 30 days (not committed)
  groq.ts          calls Groq with retries on short rate limits and server errors
  judge.ts         LLM-as-judge for grading answers
scripts/
  ingest.ts        build data/index.json
  run-evals.ts     run all questions, print both scores
  run-tool-evals.ts check the model's tool arguments
  test-tools.ts    unit tests for the leave calculator, no API calls
  try-*.ts         small scripts for testing one piece at a time
  list-models.ts   list the model ids your Groq key can use
```

## Setup

```
npm install
cp .env.example .env.local     # then add your keys
npm run ingest
npm run ask -- "How many sick days do I get?"
npm run evals
```

Keys needed:
- `VOYAGE_API_KEY` from voyageai.com (free token allowance, 3 requests per minute until a payment method is added)
- `GROQ_API_KEY` from console.groq.com (free tier, no card needed)

On Windows behind a proxy or antivirus that re-signs HTTPS traffic, Node may fail with `SELF_SIGNED_CERT_IN_CHAIN`. Set `NODE_USE_SYSTEM_CA=1` for that terminal session. Do not disable certificate checks.

## Evals

Each entry in `data/evals.json` has a question, a reference, the section that holds the answer, and a type:

- `answerable`: the answer must match the reference in meaning
- `partial`: give what the handbook says and state what it does not cover
- `unanswerable`: say the handbook does not cover it, and invent no policy

Two numbers come out of a run:
- **Retrieval hit rate**: was the right section in the top 3? Questions with `section: null` are skipped.
- **Answer correctness**: did the LLM judge pass the answer? The judge sees the question, type, reference, the retrieved sections and the answer. It must be given the sections, otherwise it cannot tell a true extra detail from an invented one.

Keeping the two apart tells you what to fix. Low hit rate means chunking or embeddings. Good hit rate with bad answers means the prompt or model.

### Status

First full run: retrieval 7/7. Four answers failed (Q1, Q3, Q5, Q7), but reading them showed the chatbot was mostly right and the judge was too strict. Fix: the judge now receives the retrieved sections, and it only demands the facts the question needs.

Second run: retrieval 7/7, answer correctness 7/9. Two failures left:
- Q3 was an eval problem. The reference demanded the public holidays, but that section was never retrieved and the question did not ask for it. The reference now marks sick leave and holidays as optional.
- Q7 was a real chatbot failure. It said prenatal leave is not covered but left out the 16 weeks of parental leave. The prompt now says to state what the sections do cover, and answers use `temperature: 0` so runs are repeatable.

Third run, after adding paraphrased questions (Q10 to Q15): retrieval 11/11, answer correctness 14/14. Getting there took two more changes:
- Q12 (standing desk) was relabeled `partial`, because the handbook never says what the home office stipend covers.
- The bot kept denying the stipend until a reminder was added right after the question in the user message. A prompt example alone did not fix it, and `reasoning_effort: "high"` turned out to be unnecessary.

Known issue: reading the passing answers shows the bot sometimes makes false claims about what the whole handbook lacks. It only sees the top 3 sections, so in Q4 it said the handbook does not mention parental leave (section 5 covers it, it just was not retrieved), and in Q11 it said the handbook does not say how to claim expenses (section 9 does). The judge cannot catch these, because it sees the same 3 sections the bot saw. A 14/14 score does not mean those answers are clean.

Fix for that issue: the judge now receives the full handbook as ground truth and fails any answer that claims the handbook does not cover something it does cover. The reminder in the user message also tells the bot to stop when the sections fully answer the question, and to say which part is missing when they answer only part. `npm run evals` now prints sections, answer and judge reason for every question, and counts "does not mention/specify/..." claims on answerable questions as `ABSENCE CLAIM, check by hand`.

Fourth run, with 7 held-out questions (Q11 to Q17, written after the prompt was tuned): retrieval 14/14, answer correctness 17/17. The fixes held on questions the prompt was not tuned on, but 7 is a small sample.

`data/evals.json` now has 21 questions: the original 10, the 7 held-out ones, and 4 more (Tokyo hotel, standing desk, dog, travel claim).

Fifth run: 20/21. Q10 ("can I work from my sofa every day?") failed once and passed twice on re-runs. The bot gave the right rule every time but added "the handbook does not say whether working from a sofa is allowed, ask HR", which is true but puts doubt on something the rule already answers. Changes:
- The judge now writes a check line for every "the handbook does not ..." sentence (`true: yes/no`, `matters: yes/no`), and code combines them into the verdict. Before this, the judge once wrote `matters: no` and still said CORRECT.
- Only `true: no` fails an answer. `matters` flipped between runs on the same input, so it is printed for reading but not enforced. Needless disclaimers are caught by the ABSENCE flag and a human look instead.
- The reminder in `answer.ts` now says a detail only counts as an uncovered part if the answer would be different depending on what the handbook said about it. Q10 no longer sends the employee to HR about the sofa, and the partial questions Q17 and Q19 still say what is missing.
- `run-evals.ts` takes ids (`run-evals.ts 10 17`) and `try-judge.ts` takes case names (`try-judge.ts F B`, which also prints the full reason), to save tokens. Groq's free tier has a 200,000 tokens per day cap, and a full run uses about 100,000.

Sixth run (full): 19/21. Q2 and Q7 failed, and reading them showed the bot dropped important details:
- Q2 said "approved overtime" but not that approval must come before the overtime is worked. The judge had passed the same answer word for word earlier, so its reference now says the advance approval is required. A new system prompt rule tells the bot to state conditions (approvals, deadlines, documents, eligibility) exactly, including when they must happen. Q2 then passed 3/3 with "approved in advance by a manager". Case H in `try-judge` checks that the old answer now fails.
- Q7 said "there is no separate maternal leave", treating the gap as a naming issue. The real gap is that parental leave starts at the birth, so leave during pregnancy is not covered. Its reference now requires saying so explicitly. A system prompt rule tells the bot to compare the employee's situation with what the policy covers (who, when it starts and ends), not words with words. Results by hand: no rule 0/3, rule in the system prompt 3/6, rule also in the reminder 0/3 (reverted). Q7 passes about half the time.
- Side-effect checks after these rules: Q5 and Q21 kept their conditions without padding, Q17 and Q19 kept their real gaps, and Q10 was clean in two runs ("including from your sofa", no disclaimer).
- The judge sometimes returned empty text: `gpt-oss` spends `max_tokens` on thinking first. The judge now has `max_tokens: 3000` and throws an error on an empty reply instead of counting it as a FAIL.

Seventh run (full): 20/21 with 0 absence claims. Q7 failed (it passes about half the time), and Q2, Q8 and Q10 gave their best answers so far: "approved in advance by a manager", no borrowed rule for damaged laptops, and "working from your sofa all week would exceed that limit".

Known weak spots:
- T5 (follow-up leave question) calls the tool about 5 runs in 8; the rest do the arithmetic themselves. A sturdier fix would be structural, for example requiring a tool call with `tool_choice` for leave-balance questions, which needs a way to recognise them first.
- Q19 sometimes says the $500 stipend "could be used" for a standing desk, a guess the handbook does not support. It did this before the follow-up changes too, and the judge catches it only some of the time.
- Q7 (pregnancy) passes about half the time. A likely fix is to have the bot write the employee's situation and what the policy covers before answering, as the judge does with its check lines, and hide those notes from the employee.
- The judge may pass a soft borrowed rule (case E in `npm run judge:test`: "reporting damage to IT follows the same principle"). Run `try-judge` after any judge prompt change.
- Both the bot and the judge vary between runs even at `temperature: 0`. On borderline questions, compare totals over several runs, not one batch of three, and read the answers.
- A judge checking meaning can miss small changes in wording, for example "flights under 6 hours" becoming "≤ 6 hours".
- Questions that need several sections are only checked against one section.

## Production basics

- **Logging** (`lib/log.ts`): every request writes one line with the time, prompt version (a fingerprint of the system prompt, reminder and tool description), question, retrieved sections and scores, tool calls with their results, answer, error, time taken and tokens. It is written in `finally`, so a request that fails halfway is logged with everything up to that point. With these fields you can tell a retrieval miss, wrong tool arguments, a tool bug, a model that ignored the tool result, and a date-dependent answer apart. A typical tool question costs about 2,900 tokens and 9 seconds.
- **Privacy:** the logs hold employees' questions word for word, which can include health details. They are kept out of git, stored one file per day, and files older than 30 days are deleted. Who can read them and telling users they are logged depend on where the bot runs.
- **Retries** (`lib/groq.ts`, `lib/embed.ts`): 429 and 5xx errors are retried, 400 and 401 are not. Groq calls retry at most twice and only when the wait is 10 seconds or less (it uses Groq's own `retry-after`, otherwise 1s then 2s). A long wait such as the daily cap fails fast. Voyage retries depend on the caller: a live question gives up after about 4 seconds, ingest waits 21 seconds up to 4 times.
- **Streaming** (`answerStream()` in `lib/answer.ts`, `streamGroq()` in `lib/groq.ts`): the answer is sent in pieces as the model writes it. Total time stays the same, but the employee sees the first words sooner and can read while the rest arrives. `answerStream()` yields events: `status` while retrieval or a tool runs ("Checking your leave balance..."), `text` for each new piece of the answer, and `done` with the full result. Tool call arguments also arrive in pieces, as fragments of a JSON string, so they are collected and parsed only when that step's stream ends. Retries happen only before the stream starts. `answer()` waits for `done`, so the evals did not change. The log records `firstTextMs` (time to first token) next to the total `ms`.
- **Errors for users:** `answer()` still throws, so a rate limit is never graded as a wrong answer in the evals. `friendlyError()` turns the error into what the employee sees ("The assistant is busy right now. Please try again in about 3 minutes."), and `try-answer.ts` uses it.

## Next steps

- Retrieval quality: eval questions that need several sections, then hybrid search (keywords plus vectors) and reranking
- Make the calculator call reliable on follow-ups, for example by requiring it with `tool_choice`
- Port follow-up questions to the `python-vers` branch
- Leave calculator: first-year proration, once HR answers the "accrues monthly" question
