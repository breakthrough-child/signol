"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageError, Spinner } from "@/components/loading";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DemoButton } from "@/components/demo-button";
import type { ProjectRow } from "@/lib/db-types";
import { ensureSession, supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const STATUS: Record<ProjectRow["status"], string> = {
  draft: "Setting up",
  locked: "Locked",
  analyzing: "Analyzing",
  analyzed: "Ready to decide",
  decided: "Decided",
};

export default function Projects() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ensureSession()
      .then(async () => {
        const { data, error } = await supabaseBrowser().from("projects").select("*").order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        setRows((data ?? []) as ProjectRow[]);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <PageError message={error} />;
  if (!rows) return <Spinner label="Loading your projects" />;
  const next = (p: ProjectRow) => (p.status === "decided" ? `/p/${p.id}/outputs` : p.status === "analyzed" ? `/p/${p.id}/board` : p.status === "draft" ? `/p/${p.id}` : `/p/${p.id}/analyze`);
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold">Your projects</h1>
        <Link href="/new" className={cn(buttonVariants())}>
          New project
        </Link>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p>No projects yet in this browser session. Your work is private to this browser unless you share a decision log.</p>
            <DemoButton size="default" label="Try the demo" />
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={next(p)} className="block">
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="space-y-1 pt-5">
                    <p className="font-display text-lg font-semibold">{p.name}</p>
                    <p className="line-clamp-2 text-sm text-ink2">{p.hypothesis}</p>
                    <p className="pt-1 text-xs font-semibold text-signal">
                      {STATUS[p.status]}
                      {p.is_demo ? " · demo" : ""}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
