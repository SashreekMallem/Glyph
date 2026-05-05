import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FadeInUp } from "@/components/motion/primitives";
import { LiveDocumentDemo } from "@/components/landing/LiveDocumentDemo";
import { BentoGrid } from "@/components/landing/BentoGrid";
import { McpTerminal } from "@/components/landing/McpTerminal";
import { CostFlywheel } from "@/components/landing/CostFlywheel";
import { CostCalculator } from "@/components/landing/CostCalculator";
import { BlockPlayground } from "@/components/landing/BlockPlayground";
import { ScrollJourney } from "@/components/landing/ScrollJourney";
import { FormatMarquee } from "@/components/landing/FormatMarquee";
import { FilmGrain } from "@/components/landing/FilmGrain";
import { MagneticButton } from "@/components/landing/MagneticButton";
import { ThemeToggle } from "@/components/landing/ThemeToggle";
import { HeroDocumentScene } from "@/components/landing/HeroDocumentSceneClient";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <FilmGrain />

      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="font-serif text-xl tracking-tight">
            Glyph
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3">
            <Link
              href="#how"
              className="hidden rounded-full px-3 py-1.5 text-sm text-neutral-600 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 sm:block"
            >
              How it works
            </Link>
            <Link
              href="#blocks"
              className="hidden rounded-full px-3 py-1.5 text-sm text-neutral-600 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 sm:block"
            >
              Blocks
            </Link>
            <Link
              href="#pricing"
              className="hidden rounded-full px-3 py-1.5 text-sm text-neutral-600 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 sm:block"
            >
              Pricing
            </Link>
            <ThemeToggle />
            <Button asChild size="sm" variant="ghost">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <MagneticButton>
              <Button asChild size="sm">
                <Link href="/sign-up">Start free</Link>
              </Button>
            </MagneticButton>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <svg
            className="absolute inset-0 h-full w-full opacity-[0.04]"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <defs>
              <pattern
                id="grid"
                width="32"
                height="32"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 32 0 L 0 0 0 32"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          <div className="absolute right-[-10%] top-[-10%] h-[420px] w-[420px] rounded-full bg-emerald-200/30 blur-3xl" />
          <div className="absolute left-[-10%] top-[20%] h-[380px] w-[380px] rounded-full bg-amber-100/40 blur-3xl" />
        </div>

        <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-12 sm:grid-cols-2 sm:items-center sm:pb-32 sm:pt-20">
          <div>
            <FadeInUp>
              <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/70 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-500 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Author free · Consumer pays
              </span>
            </FadeInUp>
            <FadeInUp>
              <h1 className="mt-6 font-serif text-5xl leading-[1.02] tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-7xl">
                Every document
                <br />
                carries its own truth.
              </h1>
            </FadeInUp>
            <FadeInUp>
              <p className="mt-6 max-w-md text-base leading-relaxed text-neutral-600 dark:text-neutral-400 sm:text-lg">
                Glyph extracts structured data once at creation and embeds it
                inside the file — encrypted, signed, self-healing. Authors
                publish for free. Every downstream system reads in 2&nbsp;ms.
              </p>
            </FadeInUp>
            <FadeInUp>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <MagneticButton>
                  <Button asChild size="lg" className="rounded-full">
                    <Link href="/sign-up">Start authoring</Link>
                  </Button>
                </MagneticButton>
                <Button
                  asChild
                  size="lg"
                  variant="ghost"
                  className="rounded-full"
                >
                  <Link href="#how">See it work →</Link>
                </Button>
              </div>
            </FadeInUp>
            <FadeInUp>
              <div className="mt-10 flex items-center gap-6 text-xs text-neutral-500">
                <span className="font-mono uppercase tracking-[0.15em]">
                  AES-256-GCM
                </span>
                <span className="font-mono uppercase tracking-[0.15em]">
                  Ed25519
                </span>
                <span className="font-mono uppercase tracking-[0.15em]">
                  MCP-native
                </span>
              </div>
            </FadeInUp>
          </div>

          <div className="relative h-[480px] sm:h-[600px]">
            <HeroDocumentScene />
          </div>
        </div>
      </section>

      {/* Format marquee */}
      <section className="border-t border-neutral-200/80 bg-white/60 dark:border-neutral-900 dark:bg-neutral-950/60">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <FormatMarquee />
        </div>
      </section>

      {/* The flywheel */}
      <section className="border-t border-neutral-200/80 bg-white/60 dark:border-neutral-900 dark:bg-neutral-950/60">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <FadeInUp>
            <div className="mb-10 max-w-xl">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                The flywheel
              </span>
              <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
                Free for authors. Paid by consumers. Every document compounds.
              </h2>
            </div>
          </FadeInUp>
          <CostFlywheel />
        </div>
      </section>

      {/* Scroll-driven journey */}
      <ScrollJourney />

      {/* Live demo */}
      <section id="how" className="bg-neutral-50 dark:bg-neutral-950">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <FadeInUp>
            <div className="mb-10 max-w-2xl">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                Try it
              </span>
              <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-5xl">
                Edit the doc. Watch the JSON catch up.
              </h2>
              <p className="mt-4 max-w-lg text-neutral-600 dark:text-neutral-400">
                Field-level fingerprints detect drift the instant a document
                touches Glyph. Only changed leaves get re-extracted —
                milliseconds, fractions of a cent.
              </p>
            </div>
          </FadeInUp>
          <LiveDocumentDemo />
        </div>
      </section>

      {/* Block playground */}
      <section id="blocks" className="border-t border-neutral-200/80 bg-white dark:border-neutral-900 dark:bg-neutral-950">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <FadeInUp>
            <div className="mb-10 max-w-xl">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                Composable schema
              </span>
              <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
                Schemas are blocks. Compose, fingerprint, share.
              </h2>
              <p className="mt-4 max-w-lg text-neutral-600 dark:text-neutral-400">
                Click blocks to compose a schema. The merged JSON Schema and
                its SHA-256 fingerprint update live. Identical compositions
                hit the cache.
              </p>
            </div>
          </FadeInUp>
          <BlockPlayground />
        </div>
      </section>

      {/* Bento features */}
      <section
        id="features"
        className="border-t border-neutral-200/80 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-950"
      >
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <FadeInUp>
            <div className="mb-12 max-w-xl">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                Architecture
              </span>
              <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
                Every part is the smallest thing that could possibly work.
              </h2>
            </div>
          </FadeInUp>
          <BentoGrid />
        </div>
      </section>

      {/* MCP */}
      <section className="border-t border-neutral-200/80 bg-white dark:border-neutral-900 dark:bg-neutral-950">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 sm:grid-cols-2 sm:items-center sm:py-28">
          <FadeInUp>
            <div>
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                Agent-native
              </span>
              <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
                Drop into Claude. Drop into Cursor. Drop into anything that
                speaks MCP.
              </h2>
              <p className="mt-4 max-w-md text-neutral-600 dark:text-neutral-400">
                The same self-healing endpoint powers the Word plugin, the
                Google Docs add-on, the in-house editor, and any agent that
                holds an API key.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {[
                  "structure_document",
                  "validate_document",
                  "generate_structured_document",
                  "read_glyph_payload",
                  "discover_schema",
                ].map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </FadeInUp>
          <McpTerminal />
        </div>
      </section>

      {/* Cost calculator */}
      <section className="border-t border-neutral-200/80 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-950">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <FadeInUp>
            <div className="mb-10 max-w-xl">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                Run the math
              </span>
              <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
                What it costs at your volume.
              </h2>
              <p className="mt-4 max-w-lg text-neutral-600 dark:text-neutral-400">
                Drag the slider. The author cost stays $0. Consumer reads
                compound — and Glyph stays the cheapest read in the market.
              </p>
            </div>
          </FadeInUp>
          <CostCalculator />
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="border-t border-neutral-200/80 bg-white dark:border-neutral-900 dark:bg-neutral-950"
      >
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <FadeInUp>
            <div className="mb-12 max-w-xl">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                Pricing
              </span>
              <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
                Authors pay nothing. Consumers pay for what they read.
              </h2>
            </div>
          </FadeInUp>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <PricingTile
              name="Author"
              price="$0"
              period="forever"
              blurb="Stamp documents with structured payloads. Unlimited."
              points={[
                "Word + Google Docs plugins",
                "Web editor",
                "Composable schema blocks",
                "Self-healing sync",
              ]}
              cta="Start authoring"
              href="/sign-up"
            />
            <PricingTile
              name="Consumer"
              price="$0.0021"
              period="per read"
              blurb="Decrypt, verify, structured data. 2 ms per call."
              points={[
                "MCP server access",
                "REST + SDK",
                "Drift-detection included",
                "Volume discounts at 1M+",
              ]}
              cta="Get an API key"
              href="/sign-up"
              highlighted
            />
            <PricingTile
              name="Enterprise"
              price="Talk to us"
              period=""
              blurb="Self-hosted control plane. SLA. SSO. Custom blocks."
              points={[
                "Private schema registry",
                "Tenant-isolated storage",
                "On-prem MCP",
                "Dedicated support",
              ]}
              cta="Contact sales"
              href="mailto:hello@glyph.dev"
            />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-neutral-200/80 bg-neutral-950 text-neutral-100">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center sm:py-32">
          <FadeInUp>
            <h2 className="font-serif text-4xl leading-tight tracking-tight text-white sm:text-6xl">
              The document is the database.
              <br />
              <span className="text-neutral-500">Glyph keeps it honest.</span>
            </h2>
          </FadeInUp>
          <FadeInUp>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <MagneticButton>
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-white text-neutral-950 hover:bg-neutral-200"
                >
                  <Link href="/sign-up">Start authoring · free</Link>
                </Button>
              </MagneticButton>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="rounded-full text-neutral-200 hover:bg-neutral-900 hover:text-white"
              >
                <Link href="/docs">Read the docs →</Link>
              </Button>
            </div>
          </FadeInUp>
        </div>
        <div className="border-t border-neutral-900">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-neutral-500">
            <span className="font-serif text-base text-neutral-400">Glyph</span>
            <span className="font-mono uppercase tracking-[0.15em]">
              © 2026 · ms@eduflixai.com
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

function PricingTile({
  name,
  price,
  period,
  blurb,
  points,
  cta,
  href,
  highlighted,
}: {
  name: string;
  price: string;
  period: string;
  blurb: string;
  points: string[];
  cta: string;
  href: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-7 ${
        highlighted
          ? "border-neutral-900 bg-neutral-950 text-neutral-100 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)]"
          : "border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      }`}
    >
      {highlighted && (
        <span className="absolute right-5 top-5 rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-emerald-300">
          Where the money is
        </span>
      )}
      <h3 className="font-serif text-2xl tracking-tight">{name}</h3>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-serif text-4xl tracking-tight">{price}</span>
        {period && (
          <span className="text-sm text-neutral-500">{period}</span>
        )}
      </div>
      <p
        className={`mt-3 text-sm ${
          highlighted ? "text-neutral-400" : "text-neutral-600 dark:text-neutral-400"
        }`}
      >
        {blurb}
      </p>
      <ul
        className={`mt-6 space-y-2 text-sm ${
          highlighted ? "text-neutral-300" : "text-neutral-700 dark:text-neutral-300"
        }`}
      >
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <span
              className={`mt-1.5 h-1 w-1 flex-none rounded-full ${
                highlighted ? "bg-emerald-400" : "bg-neutral-400"
              }`}
            />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8 pt-2">
        <MagneticButton>
          <Button
            asChild
            className={`w-full rounded-full ${
              highlighted ? "bg-white text-neutral-950 hover:bg-neutral-200" : ""
            }`}
            variant={highlighted ? "default" : "outline"}
          >
            <Link href={href}>{cta}</Link>
          </Button>
        </MagneticButton>
      </div>
    </div>
  );
}
