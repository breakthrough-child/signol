"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import type { ProjectRow } from "@/lib/db-types";
import { cn } from "@/lib/utils";

type Key = "setup" | "analyze" | "board" | "decide" | "outputs";
const order: ProjectRow["status"][] = ["draft", "locked", "analyzing", "analyzed", "decided"];

export function ProjectNav({ project, current }: { project: ProjectRow; current: Key }) {
  const rank = order.indexOf(project.status);
  const steps: { key: Key; label: string; href: string; enabled: boolean; done: boolean }[] = [
    { key: "setup", label: "Pre-commit & interviews", href: `/p/${project.id}`, enabled: true, done: rank >= 1 },
    { key: "analyze", label: "Analysis", href: `/p/${project.id}/analyze`, enabled: rank >= 1, done: rank >= 3 },
    { key: "board", label: "Evidence board", href: `/p/${project.id}/board`, enabled: rank >= 3, done: rank >= 4 },
    { key: "decide", label: "Decision", href: `/p/${project.id}/decide`, enabled: rank >= 3, done: rank >= 4 },
    { key: "outputs", label: "Outputs", href: `/p/${project.id}/outputs`, enabled: rank >= 4, done: false },
  ];
  return (
    <div className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-semibold leading-tight sm:text-3xl">{project.name}</h1>
        {project.is_demo && <span className="rounded-full bg-signalsoft px-2.5 py-0.5 text-xs font-bold text-signal">Demo project</span>}
        {project.locked_at && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-semibold text-ink2">
            <Lock size={12} aria-hidden="true" /> Hypothesis locked
          </span>
        )}
      </div>
      <nav aria-label="Project steps">
        <ol className="flex gap-1 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const body = (
              <span
                className={cn(
                  "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-semibold",
                  s.key === current ? "border-ink bg-ink text-paper" : s.enabled ? "border-line bg-card hover:bg-paper2" : "border-line/60 bg-transparent text-ink2/60",
                )}
              >
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", s.key === current ? "bg-paper text-ink" : "bg-paper2")}>
                  {s.done && s.key !== current ? <Check size={12} aria-hidden="true" /> : i + 1}
                </span>
                {s.label}
              </span>
            );
            return (
              <li key={s.key}>
                {s.enabled ? (
                  <Link href={s.href} aria-current={s.key === current ? "step" : undefined}>
                    {body}
                  </Link>
                ) : (
                  <span aria-disabled="true">{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
