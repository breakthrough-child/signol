"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { ensureSession } from "@/lib/supabase/browser";

export function DemoButton({ size = "lg", label = "Try the demo (no sign-up)" }: { size?: "lg" | "default"; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const { id } = await api<{ id: string }>("/api/demo", { method: "POST" });
      router.push(`/p/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <Button size={size} onClick={start} disabled={busy} data-testid="try-demo">
        {busy ? "Setting up the demo…" : label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-against">
          {error}
        </p>
      )}
    </div>
  );
}
