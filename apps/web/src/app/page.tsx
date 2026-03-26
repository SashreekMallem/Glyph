import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FadeInUp, Stagger } from "@/components/motion/primitives";
import { FeatureCard } from "@/components/marketing/FeatureCard";
import { StepCard } from "@/components/marketing/StepCard";
import { PricingCard } from "@/components/marketing/PricingCard";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link
          href="/"
          className="font-serif text-xl tracking-tight"
        >
          Glyph
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="#features"
            className="text-neutral-500 hover:text-neutral-900"
          >
            Features
          </Link>
          <Link
            href="#pricing"
            className="text-neutral-500 hover:text-neutral-900"
          >
            Pricing
          </Link>
          <Button asChild size="sm" variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-16 sm:pt-24">
        <FadeInUp>
          <div className="mb-4 font-mono text-[0.68rem] uppercase tracking-[0.24em] text-neutral-400">
            Structured Document Platform
          </div>
        </FadeInUp>
        <FadeInUp>
          <h1 className="max-w-4xl font-serif text-5xl leading-[1.05] tracking-tight text-neutral-900 sm:text-7xl">
            Every document you write is a database.
          </h1>
        </FadeInUp>
        <FadeInUp>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-neutral-500">
            Glyph embeds encrypted, validated JSON inside every contract,
            invoice, and resume — so the documents humans read and the data
            machines extract are always the same.
          </p>
        </FadeInUp>
        <FadeInUp>
          <div className="mt-10 flex items-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-in">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
        </FadeInUp>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <FadeInUp>
          <div className="mb-2 font-mono text-[0.68rem] uppercase tracking-[0.24em] text-neutral-400">
            Features
          </div>
          <h2 className="mb-12 max-w-2xl font-serif text-3xl tracking-tight sm:text-4xl">
            Author anywhere. Validate everywhere.
          </h2>
        </FadeInUp>
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FeatureCard
            title="Invisible structure"
            body="Typed JSON rides inside the document — encrypted, signed, and ignored by every tool that doesn't know to look."
          />
          <FeatureCard
            title="Validated at write-time"
            body="Zod-powered schemas catch malformed data the moment a field changes. No more broken extracts downstream."
          />
          <FeatureCard
            title="Extract in one call"
            body="A single API returns the exact structured object your workflow needs — no OCR, no prompt tuning, no guessing."
          />
          <FeatureCard
            title="Works where you already write"
            body="Google Docs, Word, plain Markdown, or an AI agent via MCP. Glyph attaches to the document, not the editor."
          />
          <FeatureCard
            title="Your schemas, your rules"
            body="Ship with Contract, Resume, Invoice — or define your own document types with custom field descriptors."
          />
          <FeatureCard
            title="End-to-end encrypted"
            body="AES-256-GCM payloads, RSA-PSS signatures, per-user key derivation. We can't read your data; neither can anyone else."
          />
        </Stagger>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="mx-auto max-w-6xl px-6 py-16"
      >
        <FadeInUp>
          <div className="mb-2 font-mono text-[0.68rem] uppercase tracking-[0.24em] text-neutral-400">
            How it works
          </div>
          <h2 className="mb-12 max-w-2xl font-serif text-3xl tracking-tight sm:text-4xl">
            Three moves, one source of truth.
          </h2>
        </FadeInUp>
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StepCard
            step={1}
            title="Write or generate"
            body="Compose your document in Glyph's editor, or let an AI agent generate it through MCP. Every field maps to a typed descriptor."
          />
          <StepCard
            step={2}
            title="Embed + sign"
            body="On save, the JSON is validated, encrypted, signed, and attached to the document in a canonical form."
          />
          <StepCard
            step={3}
            title="Extract anywhere"
            body="Recipients hit the Glyph API with the file and pull the exact structured object — no parsing, no ambiguity."
          />
        </Stagger>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <FadeInUp>
          <div className="mb-2 font-mono text-[0.68rem] uppercase tracking-[0.24em] text-neutral-400">
            Pricing
          </div>
          <h2 className="mb-12 max-w-2xl font-serif text-3xl tracking-tight sm:text-4xl">
            Start free. Scale when the documents do.
          </h2>
        </FadeInUp>
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <PricingCard
            name="Hobby"
            price="$0"
            cadence="mo"
            features={[
              "100 documents / mo",
              "All built-in types",
              "Community support",
            ]}
            cta="Get started"
            href="/sign-in"
          />
          <PricingCard
            name="Pro"
            price="$24"
            cadence="mo"
            features={[
              "10,000 documents / mo",
              "Custom document types",
              "API + MCP access",
              "Priority email support",
            ]}
            cta="Start Pro"
            href="/sign-in"
            highlighted
          />
          <PricingCard
            name="Team"
            price="Contact"
            cadence="us"
            features={[
              "Unlimited documents",
              "SSO + audit logs",
              "Dedicated infra",
              "SLA",
            ]}
            cta="Talk to sales"
            href="mailto:hello@glyph.dev"
          />
        </Stagger>
      </section>

      {/* Footer */}
      <footer className="mx-auto mt-16 max-w-6xl border-t border-neutral-200 px-6 py-10 text-xs text-neutral-400">
        <div className="flex items-center justify-between">
          <span>© {new Date().getFullYear()} Glyph</span>
          <span className="font-mono uppercase tracking-[0.18em]">
            Structured by default
          </span>
        </div>
      </footer>
    </main>
  );
}
