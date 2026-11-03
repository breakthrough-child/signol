import Link from "next/link";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-1 text-sm font-semibold">
          <Link className="rounded-lg px-3 py-2 hover:bg-paper2" href="/projects">
            Projects
          </Link>
          <Link className="rounded-lg px-3 py-2 hover:bg-paper2" href="/stats">
            Time saved
          </Link>
        </nav>
      </div>
    </header>
  );
}
