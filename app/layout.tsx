import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: { default: "signol: face the evidence before you decide", template: "%s · signol" },
  description:
    "signol turns founder customer interviews into an evidence-backed verdict on a hypothesis, and makes you face the strongest counter-evidence before you decide.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-6">
          {children}
        </main>
        <footer className="border-t border-line py-8 text-center text-[13px] text-ink2">
          <p>signol never makes the decision. You do. Built for the HETIC AI Agents for Founders Challenge 2026 · runs on free-tier models only.</p>
        </footer>
      </body>
    </html>
  );
}
