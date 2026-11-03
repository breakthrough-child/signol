import type { Metadata } from "next";
import Link from "next/link";
import { DecisionLogView } from "@/components/decision-log-view";
import { Alert } from "@/components/ui/alert";
import type { DecisionLog } from "@/lib/decision";
import { supabaseAnon } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared decision log", robots: { index: false, follow: false } };

export default async function SharedLog({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await supabaseAnon().rpc("shared_decision_log", { p_token: token });
  const log = data as (DecisionLog & { shared?: boolean }) | null;
  if (!log || !log.project) {
    return (
      <div className="mx-auto max-w-xl pt-10">
        <Alert tone="error" title="This link is not valid">
          The decision log was not found, or the owner has turned the link off.
        </Alert>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-4xl">
      <Alert tone="info" className="mb-6">
        This is a read-only decision log shared from <Link className="font-semibold underline" href="/">signol</Link>. Only this log is visible; the interviews themselves are private.
      </Alert>
      <DecisionLogView log={log} />
    </div>
  );
}
