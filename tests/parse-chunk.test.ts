import { describe, expect, it } from "vitest";
import { parseTranscript, applyRoles } from "@/lib/text/parse";
import { chunkTurns } from "@/lib/text/chunk";

const dialogue = `Interviewer: How do you track stock today?
Bola: We use a notebook.
It works fine for us.
Interviewer: Do you ever run out of things?
Bola: Sometimes, yes. Last month we ran out of rice on a Friday.
`;

describe("parseTranscript", () => {
  it("parses labelled dialogue and assigns roles from labels", () => {
    const p = parseTranscript(dialogue);
    expect(p.format).toBe("dialogue");
    expect(p.turns).toHaveLength(4);
    expect(p.turns[0].role).toBe("interviewer");
    expect(p.turns[1].role).toBe("interviewee");
    expect(p.turns[1].text).toBe("We use a notebook. It works fine for us.");
    expect(p.needsConfirmation).toBe(false);
  });

  it("guesses roles from question ratio and is confident when clear", () => {
    const p = parseTranscript(`Ada: How do you track stock?
Tunde: In a notebook, mostly, and sometimes on my phone when I remember to do it.
Ada: Do you ever run out?
Tunde: Yes, often. Last week it was rice and the whole Friday service suffered badly.
Ada: What did you do?
Tunde: I sent my nephew to the market to buy more at a higher price than usual.`);
    expect(p.turns[0].role).toBe("interviewer");
    expect(p.turns[1].role).toBe("interviewee");
    expect(p.needsConfirmation).toBe(false);
  });

  it("asks for confirmation when roles are ambiguous", () => {
    const p = parseTranscript(`Ada: We talked about stock yesterday. I think it matters.
Tunde: Yes it matters a lot to us here.
Ada: Right, that is what I heard too from others.
Tunde: Okay then we agree on that point.`);
    expect(p.needsConfirmation).toBe(true);
  });

  it("treats unlabelled text as notes attributed to the interviewee", () => {
    const p = parseTranscript(`Owner of a canteen in Yaba.\n\nUses a notebook every night.\n\nTried an app once, stopped.`, "Chidi");
    expect(p.format).toBe("notes");
    expect(p.turns.every((t) => t.role === "interviewee")).toBe(true);
    expect(p.turns[0].speaker).toBe("Chidi");
  });

  it("supports timestamps and markdown bold labels", () => {
    const p = parseTranscript(`[00:01] **Interviewer:** Hi, how are you?\n[00:05] **Ngozi:** Fine thanks, busy day.\n[00:09] **Interviewer:** Tell me about stock.\n[00:12] **Ngozi:** We count by hand.`);
    expect(p.turns).toHaveLength(4);
    expect(p.turns[1].speaker).toBe("Ngozi");
  });

  it("applyRoles overrides the detected roles", () => {
    const p = parseTranscript(dialogue);
    const flipped = applyRoles(p.turns, { Interviewer: "interviewee", Bola: "interviewer" });
    expect(flipped[0].role).toBe("interviewee");
    expect(flipped[1].role).toBe("interviewer");
  });
});

describe("chunkTurns", () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      idx: i,
      speaker: i % 2 ? "B" : "Q",
      role: (i % 2 ? "interviewee" : "interviewer") as "interviewee" | "interviewer",
      text: Array.from({ length: 50 }, () => "word").join(" "),
    }));

  it("keeps a question with its answer and respects the word budget", () => {
    const chunks = chunkTurns(mk(12), 220);
    for (const c of chunks) {
      expect(c.turns[0].role).toBe("interviewer");
      expect(c.turns[c.turns.length - 1].role).toBe("interviewee");
      expect(c.words).toBeLessThanOrEqual(220);
    }
    expect(chunks.flatMap((c) => c.turns)).toHaveLength(12);
  });

  it("never splits a single oversized exchange", () => {
    const big = [
      { idx: 0, speaker: "Q", role: "interviewer" as const, text: "q" },
      { idx: 1, speaker: "B", role: "interviewee" as const, text: Array.from({ length: 2000 }, () => "w").join(" ") },
    ];
    const chunks = chunkTurns(big, 500);
    expect(chunks).toHaveLength(1);
  });

  it("returns no chunks for no turns", () => {
    expect(chunkTurns([], 500)).toEqual([]);
  });
});
