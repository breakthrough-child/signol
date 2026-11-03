import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 ${className}`} aria-label="signol home">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <circle cx="9" cy="19" r="3.2" fill="var(--signal)" />
        <path d="M9 11.5a7.5 7.5 0 0 1 7.5 7.5" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M9 5a14 14 0 0 1 14 14" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
      </svg>
      <span className="font-display text-[22px] font-semibold tracking-tight">signol</span>
    </Link>
  );
}
