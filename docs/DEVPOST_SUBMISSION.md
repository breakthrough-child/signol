# Devpost submission draft

> Fill the placeholders before submitting: live URL, repo URL, video URL, team members. Everything here describes what the repository actually does.

**Project name:** signol
**Tagline:** Turn customer interviews into an evidence-backed verdict, and make founders face the evidence against them before they decide.
**Challenge:** HETIC AI Agents for Founders Challenge 2026
**Links:** Live demo `https://YOUR-DEPLOYMENT.vercel.app` · Code `https://github.com/breakthrough-child/signol` · Video `YOUR-VIDEO-URL`

## Inspiration

Founders do customer interviews, then spend 6 to 10 hours rereading notes, tagging quotes and summarising. Worse, they fool themselves. They count "great idea!" and "I'd definitely use that" as validation (compliments and promises cost the interviewee nothing), and they ask leading questions that taint the answers. The painful synthesis is only half the problem; the other half is confirmation bias. We wanted an agent that saves the hours *and* puts critical thinking into the workflow.

## What it does

signol takes a founder's interviews (pasted transcripts, notes in .txt/.md/.docx, or audio) and produces an evidence board for their hypothesis, with two human checkpoints:

1. **Pre-commit.** The founder writes the hypothesis and predicts how many interviewees will support it and how confident they are. It locks when analysis starts.
2. **Analysis.** The agent classifies every relevant statement (past behavior, current pain, future promise, compliment, opinion) and its stance, flags the founder's leading questions and the answers they tainted, **verifies every quote against the transcript in code**, and **scores the evidence in code**. A headline states the share of positive feedback that was only compliments or promises.
3. **Evidence board.** For/Against columns with exact quotes, strength, a "view in transcript" link that highlights the source, a leading-questions panel with neutral rewrites, and filters.
4. **Decision with friction.** To choose *Validated*, the founder must first open and answer the three strongest counter-evidence cards (for *Invalidated*, the strongest supporting ones). Then a neutral calibration compares their prediction with the evidence.
5. **Outputs.** A decision log (Markdown, PDF, read-only share link), a next-interview script (leading questions rewritten, plus new past-behavior questions) and measured time saved.

signol never makes the decision.

## How we built it

Next.js (App Router) + TypeScript + Tailwind with shadcn-style components, Supabase (Postgres with Row Level Security, anonymous auth, private Storage), deployed on Vercel. The LLM layer is a thin abstraction over **Groq (Llama and Whisper, free tier) with automatic fallback to Google Gemini Flash (free tier)**: retries with backoff, zod-validated JSON, one re-ask on invalid output, and per-call logging of provider, model, tokens and latency. The pipeline is a set of stored, resumable steps, so a rate limit or failure resumes from the failed step. All trust-critical logic is deterministic code: quote verification (word-level fuzzy matching), weights, taint, calibration and the friction rule (also enforced by the server and, for the lock and the immutable decision, by database triggers). Tests: Vitest unit tests, RLS tests against real Postgres, and a Playwright end-to-end test of the whole demo flow through the real model adapters against an HTTP fake of Groq and Gemini.

## Challenges we ran into

- **Making the model unable to lie.** We stopped trusting model output for anything that matters: quotes are verified in code, scores are computed in code, and "top evidence" must come from code-ranked candidates.
- **Free-tier limits.** A full run is about 15 calls and 35k tokens, which collides with per-minute and per-day caps. Hence chunking, backoff, the Gemini fallback, resumable steps and a clearly labelled cached demo analysis.
- **Friction that is real.** A UI-only gate is trivial to bypass, so the rules also live on the server and in database triggers.
- **Building without model access.** Our build environment had no model keys, so we built a fake of the Groq and Gemini HTTP APIs to test the real adapters, and said so in the disclosure.
- **Designing honest demo data.** Six invented interviews that are deliberately messy: lots of compliments, only a couple of real past-behavior signals, five leading questions and one owner who contradicts the hypothesis with concrete behavior.

## Accomplishments that we're proud of

- Every displayed quote is verified against its source transcript, and the number of verified quotes is shown.
- The decision is gated on facing counter-evidence, and the calibration view turns every project into a lesson in judgment rather than a verdict.
- A judge can test the entire flow, both checkpoints included, in under three minutes without signing up.
- Row Level Security on every table, private files, a deletion button, and an honest Responsible AI statement.

## What we learned

Most of the value of an "agent" for decision support is in what it refuses to do on its own. Splitting the work into model steps (language) and code steps (truth, scoring, rules) made the system easier to test, cheaper to run on free tiers and easier to trust. We also learned how quickly free-tier quotas shape architecture.

## What's next

- Validate and tune the prompts on real interviews (including Nigerian Pidgin and mixed-language transcripts) and measure classification quality.
- Let the founder correct a classification in the UI and see the scores update.
- Email magic-link accounts to keep work across devices (currently anonymous sessions only).
- Cross-project learning: calibration over time.
- Speaker diarisation for raw audio, and more export formats.

## Built with

`next.js` `react` `typescript` `tailwindcss` `shadcn-ui` `supabase` `postgresql` `row-level-security` `groq` `llama` `whisper` `google-gemini` `zod` `vercel` `vitest` `playwright` `pdfkit` `mammoth` `claude-code`
