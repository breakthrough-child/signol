import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  info: "border-line bg-paper2",
  warn: "border-warn/40 bg-warnsoft",
  error: "border-against/40 bg-againstsoft",
  ok: "border-support/40 bg-supportsoft",
  signal: "border-signal/40 bg-signalsoft",
} as const;

export function Alert({ tone = "info", className, title, children, ...p }: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones; title?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border p-4 text-sm leading-relaxed", tones[tone], className)} {...p}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}
