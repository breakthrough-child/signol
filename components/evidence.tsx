import Link from "next/link";
import { AlertTriangle, ArrowUpRight, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { StatementRow } from "@/lib/db-types";
import { statementWeight, strengthOf, type Strength } from "@/lib/scoring";
import { TYPE_LABELS, type Stance, type StatementType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_TONE: Record<StatementType, "support" | "signal" | "warn" | "neutral" | "against"> = {
  past_behavior: "signal",
  current_pain: "signal",
  future_promise: "warn",
  compliment: "neutral",
  opinion_general: "neutral",
  irrelevant: "neutral",
};

export function TypeBadge({ type }: { type: StatementType }) {
  return <Badge tone={TYPE_TONE[type]}>{TYPE_LABELS[type]}</Badge>;
}

const STRENGTH_PIPS: Record<Strength, number> = { strong: 3, medium: 2, weak: 1, none: 0 };
const STRENGTH_TEXT: Record<Strength, string> = { strong: "Strong evidence", medium: "Medium evidence", weak: "Weak evidence", none: "No evidence value" };

export function StrengthMeter({ weight }: { weight: number }) {
  const s = strengthOf(weight);
  const pips = STRENGTH_PIPS[s];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink2" title={`Evidence weight ${weight}`}>
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("h-2.5 w-4 rounded-sm", i < pips ? "bg-ink" : "bg-line")} />
        ))}
      </span>
      {STRENGTH_TEXT[s]}
    </span>
  );
}

export function StanceTag({ stance }: { stance: Stance }) {
  if (stance === "supports") return <Badge tone="support">Supports</Badge>;
  if (stance === "contradicts") return <Badge tone="against">Contradicts</Badge>;
  return <Badge>Neutral</Badge>;
}

export function EvidenceCard({
  statement,
  interviewLabel,
  projectId,
  rank,
  why,
  children,
}: {
  statement: StatementRow;
  interviewLabel: string;
  projectId: string;
  rank?: number;
  why?: string;
  children?: React.ReactNode;
}) {
  const w = statementWeight(statement.type, statement.tainted);
  const border = statement.stance === "supports" ? "border-l-support" : statement.stance === "contradicts" ? "border-l-against" : "border-l-line";
  return (
    <article className={cn("rounded-lg border border-line border-l-4 bg-card p-4", border)} data-testid="evidence-card" data-stance={statement.stance} data-type={statement.type}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {rank !== undefined && <Badge tone="ink" className="bg-ink text-paper border-ink">Top {rank}</Badge>}
        <StanceTag stance={statement.stance} />
        <TypeBadge type={statement.type} />
        {statement.tainted && (
          <Badge tone="warn" title="This answer followed a leading question, so it counts for less">
            <AlertTriangle size={12} aria-hidden="true" /> Tainted by leading question
          </Badge>
        )}
      </div>
      <blockquote className="font-display text-[17px] leading-snug">&ldquo;{statement.quote}&rdquo;</blockquote>
      <p className="mt-2 text-xs text-ink2">{interviewLabel}</p>
      {why && <p className="mt-2 text-sm leading-relaxed">{why}</p>}
      {!why && <p className="mt-2 text-sm leading-relaxed text-ink2">{statement.rationale}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <StrengthMeter weight={w} />
        <div className="flex items-center gap-3 text-xs font-semibold">
          {statement.verified && (
            <span className="inline-flex items-center gap-1 text-support">
              <BadgeCheck size={14} aria-hidden="true" /> verified in transcript
            </span>
          )}
          <Link className="inline-flex items-center gap-0.5 text-signal underline" href={`/p/${projectId}/t/${statement.interview_id}?s=${statement.id}#turn-${statement.turn_idx}`}>
            View in transcript <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>
      {children}
    </article>
  );
}
