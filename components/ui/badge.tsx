import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-paper2 text-ink border-line",
  signal: "bg-signalsoft text-signal border-signal/30",
  support: "bg-supportsoft text-support border-support/30",
  against: "bg-againstsoft text-against border-against/30",
  warn: "bg-warnsoft text-warn border-warn/30",
  ink: "bg-ink text-paper border-ink",
} as const;

export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}
      {...p}
    />
  );
}
