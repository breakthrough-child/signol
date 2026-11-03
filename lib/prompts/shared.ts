/**
 * Prompt library rules (apply to every prompt in lib/prompts):
 *  - Prompts are versioned constants. Bump `version` whenever the text changes,
 *    so run logs and the AI disclosure can reference the exact prompt used.
 *  - Every prompt demands STRICT JSON that matches a zod schema in lib/types.ts.
 *  - Every prompt demands exact verbatim quotes and forbids inventing content.
 *    (Code verifies quotes afterwards; the prompt only reduces how often it must drop them.)
 *  - Inputs are chunked in code so each call stays inside free-tier token limits.
 */
export const JSON_RULES = `OUTPUT RULES
- Reply with ONE JSON object and nothing else (no markdown, no commentary).
- The JSON must match the schema given below exactly. Do not add or rename keys.
- Quotes must be copied EXACTLY, character for character, from a single turn of the transcript. Never paraphrase, translate, fix grammar, merge turns, or add ellipses.
- Never invent content that is not in the input. If nothing qualifies, return an empty array.`;
