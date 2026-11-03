# AI Disclosure Statement

## Built with AI assistance

The source code, tests, seed interviews and documentation of signol were written with the assistance of **Claude Code** (Anthropic's coding agent). The authors are responsible for reviewing and running everything that ships.

## Models and tools used at runtime

All runtime models are **free-tier or open-weight**. No paid API is used.

| # | Model (default config) | Provider / plan | Role in the agent | Configured by |
|---|---|---|---|---|
| 1 | `llama-3.3-70b-versatile` (open-weight Llama) | Groq, free tier | Primary LLM for classification of statements, leading-question detection, synthesis, next-interview script | `GROQ_CHAT_MODEL` |
| 2 | `whisper-large-v3-turbo` (open-weight Whisper) | Groq, free tier | Audio transcription (primary) | `GROQ_WHISPER_MODEL` |
| 3 | `gemini-2.5-flash` | Google AI Studio (Gemini API), free tier | Fallback LLM on Groq rate limits, errors or invalid output; fallback audio transcription | `GEMINI_MODEL` |
| 4 | none (plain code) | n/a | Quote verification, scoring, taint, calibration, decision rules, speaker detection, chunking | `lib/` |

Important caveats, stated plainly:

- The model IDs above are the **defaults in `.env.example`**. The Groq and Google documentation sites were not reachable from the environment in which signol was built, so these IDs and the free-tier limits could **not be confirmed against the live docs**. Third-party summaries (2026 blog posts found by web search) agree on `llama-3.3-70b-versatile`, `whisper-large-v3-turbo` and `gemini-2.5-flash` but disagree on Gemini's free-tier limits. Verify before submission and override via environment variables if needed.
- **No real model was called during development.** The build environment had no API keys and no route to Groq. All model-dependent behaviour was tested against (a) unit tests with injected adapters and mocked `fetch`, (b) a local fake of the Groq and Gemini HTTP APIs whose answers come from a keyword heuristic, and (c) hand-annotated demo data. The quality of real Llama or Gemini output on the prompts in `lib/prompts` is therefore **untested**; the safeguards below exist precisely because model output is not trusted.
- Other tools: Supabase (Postgres, Auth, Storage; free plan), Vercel (hosting; free plan), `mammoth` (docx text extraction) and `pdfkit` (PDF export). None of these is an AI model.

## What the models are and are not allowed to do

- They **classify and summarise**. They do **not** compute scores, verify quotes, enforce the decision rules or make the decision.
- Every output must be JSON that validates against a zod schema; otherwise the model is re-asked once, then another provider is tried.
- Every quote a model returns is checked in code against the source transcript; unverifiable quotes are excluded from all numbers.
- The synthesis call never sees raw transcripts, only verified structured evidence, and its choice of "top evidence" must come from code-ranked candidates (invalid choices are replaced by the code ranking).
- User content is sent to Groq and/or Google for inference. signol does not fine-tune or train anything on it. See `RESPONSIBLE_AI.md`.

## Calls and tokens per run

Structure of one analysis of the 6-interview demo, measured from `run_logs` (`npm run report:runlogs -- --demo`):

| Step | Calls per run | Notes |
|---|---|---|
| classify | ≈ 8 | one per ~900-word chunk; the 6 demo transcripts produce 8 chunks |
| leading | 6 | one per interview |
| synthesize | 1 | |
| next-interview script | 1 | only when the founder asks for it |
| **Total** | **≈ 15 to 16** | 14 to 15 without the script |

Measured token totals from the same table were about **32,500 tokens in and 5,200 tokens out per run**. These token counts are **estimates**: they come from runs against the offline fake provider, which reports `characters / 4`. They are the right order of magnitude for a 6-interview run, but real tokenisers differ (expect roughly ±30%). To replace them with real figures, run one live analysis on the deployed or local app and execute:

```bash
DATABASE_URL=<your Supabase connection string> npm run report:runlogs -- --demo
```

Free-tier implications (limits as reported by third-party sources, unverified): Groq's `llama-3.3-70b-versatile` free tier is commonly listed at about 12K tokens per minute and 100K tokens per day. One run (~38K tokens) can therefore trip the per-minute limit mid-run (handled by retry, then Gemini fallback) and the per-day limit after about two to three runs. This is why the cached demo analysis exists, and why `chunkWords` is kept small.

## Prompt versions

`classify@1.0.0`, `leading@1.0.0`, `synthesize@1.0.0`, `script@1.0.0` (stored with each synthesis in `syntheses.prompt_versions`).

## Cached demo analysis

The demo's fallback analysis (`seed/demo.json`) was **curated by the authors** from annotated demo transcripts, not produced by a model. It is labelled "cached" in the app, and its quotes are re-verified by the same code as live runs when loaded. `npm run cache:demo` regenerates it from a real model run once keys are available.
