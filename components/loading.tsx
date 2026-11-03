import Link from "next/link";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink2">
      <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-signal" aria-hidden="true" />
      {label}…
    </span>
  );
}

export function PageError({ message }: { message: string }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-xl border border-against/40 bg-againstsoft p-6 text-center">
      <p className="font-display text-xl font-semibold">Something went wrong</p>
      <p className="mt-2 text-sm leading-relaxed">{message}</p>
      <Link href="/" className="mt-4 inline-block text-sm font-semibold underline">
        Back to the home page
      </Link>
    </div>
  );
}
