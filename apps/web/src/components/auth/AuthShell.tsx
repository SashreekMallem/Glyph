"use client";

/**
 * Auth-shell layout. Split-screen on desktop:
 *
 *   ┌─────────────────────┬───────────────────────┐
 *   │  [form column]      │  [hero column]        │
 *   │  Glyph wordmark     │  Floating document    │
 *   │  Heading            │  Live cost ticker     │
 *   │  Form               │  Brand quote          │
 *   │  Footer (terms)     │                       │
 *   └─────────────────────┴───────────────────────┘
 *
 * Mobile collapses to a single column with the form on top.
 *
 * Visual language matches the landing: serif headlines, mono micro-labels,
 * neutral palette + emerald accent, soft cast shadows, subtle film grain.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

export interface AuthShellProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="grid min-h-screen grid-cols-1 bg-neutral-50 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] dark:bg-neutral-950">
      {/* Left — form */}
      <div className="relative flex flex-col px-6 py-10 sm:px-10 lg:px-16">
        <Link
          href="/"
          className="font-serif text-xl tracking-tight text-neutral-900 dark:text-neutral-50"
        >
          Glyph
        </Link>

        <div className="my-auto w-full max-w-sm">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
              {eyebrow}
            </p>
            <h1 className="mt-3 font-serif text-3xl leading-[1.05] tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
              {title}
            </h1>
            <p className="mt-2 max-w-xs text-sm text-neutral-500 dark:text-neutral-400">
              {subtitle}
            </p>

            <div className="mt-8">{children}</div>
          </motion.div>
        </div>

        <div className="mt-auto pt-8 text-[11px] text-neutral-400">
          {footer}
        </div>
      </div>

      {/* Right — hero */}
      <AuthHero />
    </main>
  );
}

// ---------------------------------------------------------------------------
// AuthHero — the right column. Premium, restrained: subtle gradient
// background, a layered "floating document" mockup, a single live cost
// ticker, a brand-quote pull. No 3D canvas weight on auth pages.
// ---------------------------------------------------------------------------

function AuthHero() {
  return (
    <div className="relative hidden overflow-hidden bg-neutral-100/60 dark:bg-neutral-900 lg:block">
      {/* Background washes */}
      <div className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute right-[-15%] top-[-15%] h-[480px] w-[480px] rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-15%] h-[420px] w-[420px] rounded-full bg-amber-100/40 blur-3xl" />
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.04] text-neutral-900 dark:text-neutral-100"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <defs>
            <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>
      </div>

      <div className="relative flex h-full flex-col px-12 py-16">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
          Author free · Consumer pays
        </div>

        <h2 className="mt-3 max-w-md font-serif text-3xl leading-[1.05] tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
          Every document carries its own truth.
        </h2>

        <div className="my-auto flex items-center justify-center py-12">
          <FloatingDocument />
        </div>

        <Ticker />
      </div>
    </div>
  );
}

function FloatingDocument() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, rotateY: 12 }}
      animate={{ opacity: 1, y: 0, rotateY: 8 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      style={{ transformStyle: "preserve-3d", perspective: 1200 }}
      className="relative"
    >
      {/* Soft drop shadow underneath */}
      <div
        aria-hidden
        className="absolute left-1/2 top-full h-12 w-[80%] -translate-x-1/2 rounded-[50%] bg-black/20 blur-2xl"
        style={{ transform: "translateZ(-40px) translateY(-6px)" }}
      />
      <div
        className="rounded-xl bg-[#fdfcfa] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.25),0_18px_36px_-18px_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-neutral-100"
        style={{ width: 360, padding: "36px 36px" }}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-neutral-400">
          Resume · Ada Lovelace
        </div>
        <div className="mt-3 font-serif text-3xl leading-[1.05] tracking-tight text-neutral-900">
          Ada Lovelace
        </div>
        <div className="mt-1 text-[13px] text-neutral-500">
          Lead Algorithmist · 1843–1852
        </div>

        <div className="mt-5 h-px w-full bg-neutral-200" />

        <div className="mt-4 font-mono text-[9px] uppercase tracking-[0.22em] text-neutral-400">
          Experience
        </div>
        <div className="mt-2 space-y-1">
          <div className="text-[12px] text-neutral-900">
            <span className="font-medium">Analytical Engine Co.</span>
            <span className="text-neutral-500"> — Algorithmist</span>
          </div>
        </div>

        <div className="mt-4 font-mono text-[9px] uppercase tracking-[0.22em] text-neutral-400">
          Skills
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Algorithms", "Cryptanalysis", "Mathematics"].map((s) => (
            <span
              key={s}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
            >
              {s}
            </span>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-neutral-100 pt-3 font-mono text-[9px] uppercase tracking-[0.18em]">
          <span className="text-neutral-400">glyph stamp</span>
          <span className="text-emerald-600">✓ signed</span>
        </div>
      </div>

      {/* Floating annotation chips */}
      <div
        className="absolute -right-12 top-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700 backdrop-blur-sm"
        style={{ transform: "translateZ(50px)" }}
      >
        ✓ Ed25519
      </div>
      <div
        className="absolute -left-14 bottom-12 rounded-full border border-neutral-200 bg-white/85 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-700 backdrop-blur-sm"
        style={{ transform: "translateZ(50px)" }}
      >
        AES-256-GCM
      </div>
    </motion.div>
  );
}

function Ticker() {
  return (
    <div className="grid grid-cols-3 gap-3 border-t border-neutral-200/70 pt-6 dark:border-neutral-800">
      <Stat label="Author cost" value="$0" sub="subsidized" />
      <Stat label="Reads served" value="1.4M" sub="and counting" />
      <Stat label="Avg. read" value="2 ms" sub="$0.0021 per read" />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="font-mono text-[0.55rem] uppercase tracking-[0.22em] text-neutral-400">
        {label}
      </div>
      <div className="mt-1 font-serif text-2xl tracking-tight text-neutral-900 dark:text-neutral-50">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-neutral-500">{sub}</div>
    </div>
  );
}
