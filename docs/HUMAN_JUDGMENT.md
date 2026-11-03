# Human Judgment

signol is a decision-*support* agent. It is designed so that the founder, not the model, owns the conclusion, and so that the founder's own biases are put under pressure instead of flattered.

## What the agent does

- Reads the interviews and splits them into speaker turns (asking the user when it cannot tell who is who).
- Classifies each relevant statement by *type* (past behavior, current pain, future promise, compliment, opinion) and *stance* toward the hypothesis, with a verbatim quote and a one-sentence reason.
- Flags the interviewer's leading questions, proposes neutral rewrites, and down-weights the answers they may have tainted.
- Verifies in code that every quote exists in the transcript, and computes the evidence scores in code.
- Synthesises themes, the strongest evidence for and against, and open questions.
- Writes a next-interview script and an exportable record of the decision.

## What the human decides

- The hypothesis, the target customer and the prediction (Checkpoint 1).
- Whether to accept the speaker detection when it is uncertain.
- Whether the evidence is enough, and the call itself: **Validated**, **Invalidated** or **Need more evidence** (Checkpoint 2).
- How to respond to the strongest counter-evidence, in their own words.
- What to do next. signol never recommends a verdict, and its headline and calibration text are descriptive.

## Why each checkpoint exists

### Checkpoint 1: pre-commit before analysis

Hindsight bias makes any outcome feel predictable after the fact. Writing down the hypothesis, the number of expected supporters and a confidence level *before* seeing results creates a fixed reference point. The fields lock when analysis starts, at the database level, so the founder cannot quietly rewrite what they believed. After the decision, the calibration view compares prediction and evidence neutrally ("you predicted 5 of 6; 3 showed strong supporting evidence"), which turns each project into a small calibration exercise.

### Checkpoint 2: the decision, with friction

The decision is a deliberate act, not a click on a dashboard. Three choices are always available, and *Need more evidence* is a first-class, friction-free outcome so that uncertainty is not punished.

## How the friction design counters confirmation bias

| Bias | How signol counters it |
|---|---|
| **Seeking only confirming evidence** | To choose *Validated*, the founder must open and answer the 3 strongest counter-evidence cards; to choose *Invalidated*, the 3 strongest supporting cards. The rule is enforced by the server, so it cannot be bypassed in the browser. |
| **Skimming** | Cards must be opened and answered with a real sentence (empty or filler responses such as "ok" are rejected). The written responses are stored in the decision log, so the founder can be held to them later. |
| **Counting politeness as validation** | Compliments weigh zero and future promises weigh little; the headline stat says what share of the positive feedback was compliments or promises. |
| **Leading the witness** | Leading questions are named, rewritten neutrally, and the answers they provoked are down-weighted ("tainted"). |
| **Fabricated or distorted support** | Every quote is verified against the transcript by code and linked to the exact highlighted passage; unverifiable quotes are excluded and counted. |
| **Hindsight rewriting** | Pre-committed, locked prediction compared with the evidence afterwards. |
| **Model overreach** | The model cannot score, verify or decide; "top evidence" must come from code-ranked candidates; the verdict is never suggested. |

## Where the human can overrule the agent

Everything is inspectable: the board links each claim to its exact place in the transcript, so the founder can disagree with a classification. (Editing individual classifications in the UI is not implemented yet; see "What's next" in the Devpost draft.) Responses to evidence are free text, and the decision is theirs even when the evidence is lopsided.
