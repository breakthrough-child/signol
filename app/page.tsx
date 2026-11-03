import Link from "next/link";
import { DemoButton } from "@/components/demo-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const steps = [
  {
    n: "1",
    title: "Pre-commit",
    body: "Write down your hypothesis and predict how many interviewees will back it, and how sure you are, before you see any analysis. It locks when analysis starts.",
  },
  {
    n: "2",
    title: "Analyze",
    body: "signol reads your interviews, separates real behavior from compliments and promises, flags your leading questions, and checks that every quote really exists.",
  },
  {
    n: "3",
    title: "Decide",
    body: "You read the strongest evidence against what you want to believe, answer it in your own words, and only then choose: validated, invalidated, or need more evidence.",
  },
];

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 md:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-[13px] font-semibold text-ink2">
            <span className="h-2 w-2 rounded-full bg-signal" aria-hidden="true" /> For founders who just finished their customer interviews
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Face the evidence against your idea <em className="text-signal not-italic">before</em> you decide.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink2">
            After interviews, founders spend 6 to 10 hours rereading notes, and still count &ldquo;great idea!&rdquo; as validation. signol does the synthesis in minutes, then makes you look at the counter-evidence before you choose.
          </p>
          <div className="mt-8 flex flex-wrap items-start gap-3">
            <DemoButton />
            <Link href="/new" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              Start your own project
            </Link>
          </div>
          <p className="mt-3 text-[13px] text-ink2">The demo loads 6 sample interviews with Lagos restaurant owners. Runs in under 3 minutes. Free, nothing to install.</p>
        </div>

        <Card className="overflow-hidden" aria-label="Example of the headline result">
          <CardHeader className="border-b border-line bg-paper2">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink2">Example result</p>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <p className="font-display text-6xl font-semibold leading-none text-signal">71%</p>
            <p className="text-base font-semibold leading-snug">of the positive feedback was compliments or promises, not evidence.</p>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-supportsoft p-2 text-support">
                <b className="block text-lg">11</b>strong for
              </div>
              <div className="rounded-lg bg-againstsoft p-2 text-against">
                <b className="block text-lg">9</b>strong against
              </div>
              <div className="rounded-lg bg-warnsoft p-2 text-warn">
                <b className="block text-lg">9</b>tainted answers
              </div>
            </div>
            <blockquote className="border-l-4 border-against pl-3 text-sm italic leading-relaxed">
              &ldquo;I used it for one week and then I deleted it.&rdquo;
              <span className="mt-1 block text-xs not-italic text-ink2">Interview 5 · past behavior · verified in transcript</span>
            </blockquote>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="font-display text-2xl font-semibold">
          How it works
        </h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n}>
              <Card className="h-full">
                <CardHeader>
                  <span className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-paper">{s.n}</span>
                  <CardTitle>{s.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-[15px] leading-relaxed text-ink2">{s.body}</CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="guards" className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 id="guards" className="font-display text-2xl font-semibold">
            Built so you cannot fool yourself
          </h2>
          <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink2">
            <li>
              <b className="text-ink">Behavior beats promises.</b> Past behavior is weighted far above &ldquo;I would definitely pay&rdquo;. Compliments weigh nothing.
            </li>
            <li>
              <b className="text-ink">Your leading questions are flagged.</b> Answers that followed one are down-weighted, and you get a neutral rewrite.
            </li>
            <li>
              <b className="text-ink">No invented quotes.</b> Every quote is checked against your transcript by code, not by the AI. Unverifiable quotes are excluded.
            </li>
            <li>
              <b className="text-ink">Friction by design.</b> To say &ldquo;validated&rdquo; you must answer the 3 strongest counter-evidence cards first.
            </li>
          </ul>
        </div>
        <Card className="bg-paper2">
          <CardHeader>
            <CardTitle>You decide, always</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[15px] leading-relaxed text-ink2">
            <p>signol reports what the evidence shows and where it is weak. It never says whether your idea is good. Two human checkpoints sit in front of every decision: your prediction before analysis, and your written response to the evidence after it.</p>
            <p>
              Works with pasted transcripts, notes (.txt, .md, .docx) and audio (mp3, m4a, wav). Built on free-tier open-weight models.{" "}
              <Link className="font-semibold text-signal underline" href="/stats">
                See measured time saved
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
