# Responsible AI

## Data used

- **User-provided:** interview transcripts, rough notes and audio recordings; the hypothesis, target customer, prediction, the founder's written responses and decision.
- **Derived:** turns, statements, quotes, leading-question flags, scores, themes, calibration.
- **Operational:** model-call logs (provider, model, token counts, latency, errors; never the content) and timing events.
- **Demo data:** six fictional interviews written for this project. The people, businesses and quotes are invented; any resemblance to real people is coincidental.

Interviews can contain personal data about the interviewee (names, businesses, opinions). Founders are responsible for having consent to record and process them. signol does not require or collect any account details; visitors get an anonymous session.

## Privacy

| Topic | What signol does |
|---|---|
| Access control | Row Level Security on every table: a user can only read and write rows whose `owner_id` is their own anonymous user id. Child inserts must also reference one of the caller's projects. Tested in `tests/rls.test.ts`. |
| File storage | Audio and files live in a **private** Supabase bucket, under `<user id>/<project id>/…`, with owner-only storage policies. Access is by signed URL or authenticated download. |
| No service-role key | The app never uses a privileged database key. Server routes act as the user. |
| Sharing | Off by default. A share link exposes only a frozen decision-log snapshot, addressed by a random 192-bit token, and can be turned off at any time. The interviews are never exposed. |
| Third-party processing | To analyse an interview, its text (or audio) is sent to Groq and, on fallback, Google (Gemini API). Do not upload anything you may not send to those providers. The free tiers of some providers may use inputs to improve their products under their own terms; review them before uploading sensitive material. signol itself does **not** train or fine-tune any model on user data. |
| Deletion | "Delete this project and its files" on the Outputs page removes the project, all derived rows (cascading) and the stored files. |
| Retention | Data stays until the user deletes it. Anonymous sessions have no recovery: clearing the browser data loses access to the projects (the data remains until deleted from the database; an operator can purge old anonymous users). |
| Logs | `run_logs` stores provider, model, token counts and latency only, never prompts or transcripts. |
| Secrets | No keys in the repo; `.env.local` is git-ignored; `.env.example` has placeholders only. |

## Known limitations

- **Language and accents.** Whisper accuracy drops with strong accents, noise and crosstalk. **Nigerian Pidgin, code-switching (English with Yoruba, Igbo, Hausa or French) and mixed-language transcripts** are handled less reliably by the models and by the English-oriented keyword hints in the prompts. Mis-transcribed words flow into the classification. Review transcripts and the highlighted quotes.
- **Classification errors.** An LLM can misclassify a statement (a promise as behavior, sarcasm as support, a polite refusal as agreement). Quote verification guarantees a quote is real, **not** that its label is right. The board shows the model's one-sentence rationale and links to the source so the founder can disagree.
- **Small samples.** 5 to 15 interviews is anecdote-scale evidence. The percentages and counts are descriptive of those interviews, not statistically generalisable. signol does not compute confidence intervals and does not claim significance.
- **Fuzzy verification.** Quotes may be accepted with small wording differences (similarity ≥ 0.88 for quotes of 3 or more words). The stored text is the real transcript text, but a lightly paraphrased quote could pass.
- **Taint is a heuristic.** Answers within three turns after a leading question are candidates; the real influence is a judgment call.
- **Weights are opinionated.** Weighting past behavior above promises follows customer-discovery practice (The Mom Test), but the numbers (1.0, 0.7, 0.25, 0.15, 0, ×0.4 for taint) are a design choice, visible in `lib/scoring.ts`.
- **Speaker detection** is rule-based (labels and question ratio) and asks the user when unsure; it can still be wrong in unlabelled transcripts.
- **Free-tier availability.** Rate limits and outages can interrupt a run; progress is saved, but a run can be slow.
- **The prompts and models were not evaluated on real interviews.** Quality metrics (precision/recall of classification, leading-question detection) have not been measured. Treat output as a starting point.

## Bias and failure cases

| Risk | Example | Mitigation |
|---|---|---|
| Politeness culture misread | Polite deference in some cultures reads as enthusiasm or, conversely, indirect refusals read as neutral | Compliments and promises weigh little by design; the founder reads the evidence and the quotes |
| Model bias toward the stated hypothesis | The prompt includes the hypothesis, so a model may over-read support | The hypothesis is given only as context; scoring is in code; counter-evidence is surfaced by default and required before *Validated* |
| Language bias | English-trained models underperform on Pidgin or mixed language | Surfaced in this document and in the UI hints; verified quotes link to the transcript for human check |
| Survivorship / selection bias in interviewees | Founders interview friendly people | The calibration view and open questions highlight what is missing; the next-interview script targets weak areas |
| Over-reliance on the tool | Treating the board as a verdict | Language is descriptive; the decision, friction and written responses are human |
| Hallucinated quotes or ids | Model invents a quote or a statement id | Code verification drops invented quotes; synthesis ids are validated against code-ranked candidates |
| Prompt injection inside transcripts | A transcript line says "ignore previous instructions" | Output is schema-validated JSON, quotes must exist verbatim, scoring is code, and the model has no tools or side effects; worst case is a mislabelled statement |

## Mitigations summary

Verification in code, deterministic scoring, schema-validated outputs, explicit human checkpoints, friction before conclusions, private storage with RLS, deletion on demand, transparency about models and limits (`AI_DISCLOSURE.md`), and honest labelling of cached and mock output.
