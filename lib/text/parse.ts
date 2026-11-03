import type { Role, Turn } from "@/lib/types";

export interface SpeakerInfo {
  label: string;
  role: Role;
  turnCount: number;
  questionRatio: number;
  avgWords: number;
}

export interface ParsedTranscript {
  turns: Turn[];
  speakers: SpeakerInfo[];
  /** "dialogue" = speaker-labelled transcript, "notes" = unstructured notes */
  format: "dialogue" | "notes";
  /** True when interviewer/interviewee could not be told apart confidently. */
  needsConfirmation: boolean;
}

const LABEL_RE =
  /^\s*(?:[-*>]\s*)?(?:\[?\(?\d{1,2}:\d{2}(?::\d{2})?\)?\]?\s*)?(?:\*\*|__)?([A-Za-z][A-Za-z0-9 .'’\-()\/]{0,40}?)(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.*)$/;

const INTERVIEWER_LABELS =
  /^(interviewer|int|i|q|me|moderator|host|researcher|founder|us|interview|asker)$/i;
const INTERVIEWEE_LABELS =
  /^(interviewee|respondent|participant|customer|a|guest|subject|owner|user)$/i;

const NOT_SPEAKERS = /^(note|notes|summary|context|tldr|tl;dr|todo|date|time|location|topic|source|key|quote|action|next steps?)$/i;

export function parseTranscript(raw: string, hintInterviewee?: string): ParsedTranscript {
  const text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  const rawTurns: { speaker: string; text: string }[] = [];
  let labelled = 0;
  for (const line of lines) {
    const m = line.match(LABEL_RE);
    if (m && !NOT_SPEAKERS.test(m[1].trim()) && m[1].trim().split(/\s+/).length <= 4) {
      labelled++;
      rawTurns.push({ speaker: m[1].trim(), text: m[2].trim() });
    } else if (line.trim() === "") {
      continue;
    } else if (rawTurns.length > 0 && labelled > 0) {
      rawTurns[rawTurns.length - 1].text += (rawTurns[rawTurns.length - 1].text ? " " : "") + line.trim();
    } else {
      rawTurns.push({ speaker: "", text: line.trim() });
    }
  }

  const labels = new Set(rawTurns.filter((t) => t.speaker).map((t) => t.speaker.toLowerCase()));
  const isDialogue = labelled >= 3 && labels.size >= 2;

  if (!isDialogue) {
    // Notes: paragraph-level turns, all attributed to the interviewee.
    const paras = text
      .split(/\n{2,}|\n(?=\s*[-*•]\s)/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const turns: Turn[] = paras.map((p, idx) => ({
      idx,
      speaker: hintInterviewee || "Notes",
      role: "interviewee",
      text: p,
    }));
    return {
      turns,
      speakers: [
        {
          label: hintInterviewee || "Notes",
          role: "interviewee",
          turnCount: turns.length,
          questionRatio: 0,
          avgWords: 0,
        },
      ],
      format: "notes",
      needsConfirmation: false,
    };
  }

  // Merge consecutive same-speaker turns and drop empties.
  const merged: { speaker: string; text: string }[] = [];
  for (const t of rawTurns) {
    if (!t.text) continue;
    const sp = t.speaker || merged[merged.length - 1]?.speaker || "Unknown";
    const last = merged[merged.length - 1];
    if (last && last.speaker.toLowerCase() === sp.toLowerCase()) last.text += " " + t.text;
    else merged.push({ speaker: sp, text: t.text });
  }

  const stats = new Map<string, { label: string; n: number; q: number; words: number }>();
  for (const t of merged) {
    const k = t.speaker.toLowerCase();
    const s = stats.get(k) ?? { label: t.speaker, n: 0, q: 0, words: 0 };
    s.n++;
    if (/\?/.test(t.text)) s.q++;
    s.words += t.text.split(/\s+/).length;
    stats.set(k, s);
  }

  const roles = assignRoles([...stats.values()], hintInterviewee);
  const turns: Turn[] = merged.map((t, idx) => ({
    idx,
    speaker: t.speaker,
    role: roles.map.get(t.speaker.toLowerCase()) ?? "interviewee",
    text: t.text,
  }));
  const speakers: SpeakerInfo[] = [...stats.values()].map((s) => ({
    label: s.label,
    role: roles.map.get(s.label.toLowerCase()) ?? "interviewee",
    turnCount: s.n,
    questionRatio: s.n ? s.q / s.n : 0,
    avgWords: s.n ? s.words / s.n : 0,
  }));
  return { turns, speakers, format: "dialogue", needsConfirmation: roles.needsConfirmation };
}

function assignRoles(
  stats: { label: string; n: number; q: number; words: number }[],
  hintInterviewee?: string,
): { map: Map<string, Role>; needsConfirmation: boolean } {
  const map = new Map<string, Role>();
  let explicit = 0;
  for (const s of stats) {
    if (INTERVIEWER_LABELS.test(s.label)) {
      map.set(s.label.toLowerCase(), "interviewer");
      explicit++;
    } else if (INTERVIEWEE_LABELS.test(s.label)) {
      map.set(s.label.toLowerCase(), "interviewee");
      explicit++;
    }
  }
  if (hintInterviewee) {
    for (const s of stats) {
      if (s.label.toLowerCase().includes(hintInterviewee.toLowerCase())) {
        map.set(s.label.toLowerCase(), "interviewee");
        explicit++;
      }
    }
  }
  const unresolved = stats.filter((s) => !map.has(s.label.toLowerCase()));
  if (explicit > 0 && unresolved.length === 0) return { map, needsConfirmation: false };

  // If an interviewer is known, everyone else is an interviewee (and vice versa for 2 speakers).
  const hasInterviewer = [...map.values()].includes("interviewer");
  const hasInterviewee = [...map.values()].includes("interviewee");
  if (explicit > 0 && stats.length === 2) {
    for (const s of unresolved) {
      map.set(s.label.toLowerCase(), hasInterviewer ? "interviewee" : "interviewer");
    }
    return { map, needsConfirmation: false };
  }
  if (hasInterviewer && !hasInterviewee) {
    for (const s of unresolved) map.set(s.label.toLowerCase(), "interviewee");
    return { map, needsConfirmation: false };
  }

  // Statistical guess: the interviewer asks more questions in shorter turns.
  const pool = unresolved.length ? unresolved : stats;
  const ranked = [...pool].sort((a, b) => b.q / b.n - a.q / a.n || a.words / a.n - b.words / b.n);
  const top = ranked[0];
  const second = ranked[1];
  const topRatio = top.q / top.n;
  const secondRatio = second ? second.q / second.n : 0;
  const confident =
    !second ||
    (topRatio - secondRatio >= 0.25 && top.words / top.n < (second.words / second.n) * 1.25);
  for (const s of pool) map.set(s.label.toLowerCase(), s === top ? "interviewer" : "interviewee");
  return { map, needsConfirmation: !confident };
}

/** Re-apply a user-confirmed role map (label -> role) to already-parsed turns. */
export function applyRoles(turns: Turn[], roles: Record<string, Role>): Turn[] {
  const lower = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k.toLowerCase(), v]));
  return turns.map((t) => ({ ...t, role: lower[t.speaker.toLowerCase()] ?? t.role }));
}
