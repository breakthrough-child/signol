# Time Saved Report

## Task, before and after

| | Before (manual) | After (with signol) |
|---|---|---|
| Task | Reread 6 to 15 interview transcripts or notes, tag quotes, separate real evidence from politeness, summarise, decide | Paste or upload interviews, lock a prediction, run analysis, read the evidence board, answer the strongest counter-evidence, decide |
| Typical effort | **6 to 10 hours** *(figure from the challenge brief; not measured by us)* | Analysis in a few minutes of machine time, plus the founder's own reading and writing time |
| What was easy to skip | Counter-evidence, leading-question damage, whether a quote is really what was said | Not skippable: the decision is gated on answering the strongest counter-evidence |

## Method

signol records its own timing events (table `timing_events`) and every model call (`run_logs`):

- **Analysis time:** `analysis_started` to `analysis_finished` (server side).
- **Time on evidence board:** visible-tab seconds on the board page, reported when the founder leaves it.
- **Time to decision:** `analysis_started` to `decision_made` (wall clock; includes reading, writing the responses and any idle time).
- **Benchmark mode (optional):** the founder records how long manual synthesis took (or takes) them for the same interviews. `/stats` then reports `manual minutes − time to decision` and the percentage saved.

Averages are computed on the `/stats` page from stored events (`lib/stats.ts`, unit tested). Cached runs are counted separately and excluded from analysis-time, call and token averages, because a cached run has no model latency.

## Results

### Demo run, pre-filled

These are the only numbers measured so far. **They are not a time-saved claim:** they were produced against an offline fake of the model APIs (no network latency, no real model time), with an automated browser instead of a human reader, so they measure pipeline overhead only.

| Run | Source | Interviews | Words | Model calls | Analysis time | Time on board | Time to decision | Manual benchmark | Saved |
|---|---|---|---|---|---|---|---|---|---|
| Automated demo, offline fake (6 runs) | live pipeline | 6 | ~5,400 | 15 to 16 | 1.7 to 2.2 s (pipeline overhead only) | n/a (no human) | ~4 s (no human reading) | n/a | n/a |
| Automated demo, cached | cached | 6 | ~5,400 | 0 | 0.2 to 0.4 s | n/a | 1 to 2 s | n/a | n/a |

Expected analysis time with a real model, **estimate only, not measured**: 15 sequential calls at roughly 1 to 5 s each, plus retries when the free tier rate-limits, i.e. on the order of one to three minutes. Replace with the measured value from `/stats` after the first real run.

### Real sessions (to fill in)

Ask each tester to tick Benchmark mode and enter how long they would normally spend, then copy the numbers from the Outputs page or `/stats`.

| Tester (role) | Interviews / words | Manual minutes (benchmark) | Analysis (s) | Board (s) | Time to decision (min) | Time saved (min) | Saved (%) | Notes |
|---|---|---|---|---|---|---|---|---|
| Founder A | | | | | | | | |
| Founder B | | | | | | | | |
| Founder C | | | | | | | | |
| Judge demo | 6 / ~5,400 | *(their own estimate)* | | | | | | |
| **Average** | | | | | | | | |

## Limitations of this measurement

- Time to decision is wall-clock and includes idle time; it overstates the founder's active time, which makes the saving look smaller than it is.
- Manual benchmarks are self-reported estimates and vary a lot by founder.
- The demo interviews are short (about 900 words each); real interviews and audio are longer, and audio transcription adds time.
