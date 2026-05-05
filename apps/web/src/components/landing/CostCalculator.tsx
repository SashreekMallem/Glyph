"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";

/**
 * Cost calculator. The slider drives:
 *   - Author cost (always $0)
 *   - Estimated reads/month (docs × 14)
 *   - Estimated platform revenue ($0.0021 / read)
 *   - A live three-card competitor comparison
 *
 * Snap points are logarithmic: 1k, 10k, 100k, 1M, 10M docs/mo.
 * Numbers animate smoothly with a fast cubic-out ease.
 */

const SNAPS = [1_000, 10_000, 100_000, 1_000_000, 10_000_000] as const;
const READS_PER_DOC = 14;
const GLYPH_PER_READ = 0.0021;
const COMPETITOR_PER_READ = 0.02;
const DIY_PER_READ = 0.0042;

type Snap = (typeof SNAPS)[number];

export function CostCalculator() {
  const [docs, setDocs] = useState<Snap>(100_000);
  const reduced = useReducedMotion();

  const reads = docs * READS_PER_DOC;
  const platformRev = reads * GLYPH_PER_READ;
  const competitorTotal = reads * COMPETITOR_PER_READ;
  const diyTotal = reads * DIY_PER_READ;

  return (
    <div className="space-y-6 sm:space-y-8">
      <SnapSlider value={docs} onChange={setDocs} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat label="Author cost" prefix="$" value={0} suffix=" / mo" sub="subsidized" reduced={!!reduced} />
        <Stat
          label="Consumer reads / mo"
          value={reads}
          sub="≈ 14 reads per doc"
          reduced={!!reduced}
        />
        <Stat
          label="Estimated platform revenue"
          prefix="$"
          value={platformRev}
          suffix=" / mo"
          sub="9.5× cheaper for consumers"
          decimals={0}
          reduced={!!reduced}
          accent
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <CompareCard
          name="Glyph"
          perRead={GLYPH_PER_READ}
          total={platformRev}
          highlighted
        />
        <CompareCard
          name="Affinda-style competitor"
          perRead={COMPETITOR_PER_READ}
          total={competitorTotal}
        />
        <CompareCard
          name="In-house Gemini"
          perRead={DIY_PER_READ}
          total={diyTotal}
          subnote="+ eng overhead"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

function SnapSlider({ value, onChange }: { value: Snap; onChange: (s: Snap) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const idx = SNAPS.indexOf(value);
  const fillPct = (idx / (SNAPS.length - 1)) * 100;
  const dragging = useRef(false);

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const i = Math.round(pct * (SNAPS.length - 1));
    onChange(SNAPS[i]!);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuemin={SNAPS[0]}
      aria-valuemax={SNAPS[SNAPS.length - 1]}
      aria-valuenow={value}
      aria-valuetext={`${value.toLocaleString()} documents per month`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(SNAPS[Math.max(0, idx - 1)]!);
        }
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(SNAPS[Math.min(SNAPS.length - 1, idx + 1)]!);
        }
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        setFromClientX(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className="relative h-12 cursor-pointer select-none touch-none focus:outline-none"
    >
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-neutral-200 dark:bg-neutral-800" />
      {/* Fill */}
      <motion.div
        className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-emerald-500"
        animate={{ width: `${fillPct}%` }}
        transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
      />
      {/* Snap dots */}
      {SNAPS.map((snap, i) => {
        const pct = (i / (SNAPS.length - 1)) * 100;
        const active = i <= idx;
        return (
          <div
            key={snap}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct}%` }}
          >
            <div
              className={`h-2 w-2 rounded-full transition-colors ${
                active
                  ? "bg-emerald-500"
                  : "bg-neutral-300 dark:bg-neutral-700"
              }`}
            />
            <div className="mt-3 -translate-x-1/2 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-neutral-500">
              {formatCompact(snap)}
            </div>
          </div>
        );
      })}
      {/* Thumb */}
      <motion.div
        className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18),0_4px_14px_rgba(16,185,129,0.4)] ring-2 ring-white dark:ring-neutral-950"
        animate={{ left: `${fillPct}%` }}
        transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat panel with smoothly animated value
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  prefix = "",
  suffix = "",
  sub,
  decimals = 0,
  reduced,
  accent,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  sub: string;
  decimals?: number;
  reduced: boolean;
  accent?: boolean;
}) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(formatNumber(value, decimals));

  useEffect(() => {
    if (reduced) {
      mv.set(value);
      setDisplay(formatNumber(value, decimals));
      return;
    }
    const controls = animate(mv, value, {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(formatNumber(v, decimals)),
    });
    return () => controls.stop();
  }, [value, decimals, reduced, mv]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-6 sm:p-7 ${
        accent
          ? "border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white dark:border-emerald-900/40 dark:from-emerald-900/20 dark:to-neutral-900"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
        {label}
      </div>
      <div className="mt-3 font-serif text-3xl tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
        {prefix}
        {display}
        {suffix}
      </div>
      <div className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        {sub}
      </div>
    </div>
  );
}

function CompareCard({
  name,
  perRead,
  total,
  highlighted,
  subnote,
}: {
  name: string;
  perRead: number;
  total: number;
  highlighted?: boolean;
  subnote?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 ${
        highlighted
          ? "border-emerald-300 bg-white shadow-[0_0_0_4px_rgba(16,185,129,0.06)] dark:border-emerald-900 dark:bg-neutral-900"
          : "border-neutral-200 bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/60"
      }`}
    >
      <div
        className={`font-mono text-[0.65rem] uppercase tracking-[0.18em] ${
          highlighted ? "text-emerald-600" : "text-neutral-400"
        }`}
      >
        {name}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-serif text-2xl tracking-tight text-neutral-900 dark:text-neutral-50">
          ${perRead.toFixed(4)}
        </span>
        <span className="text-xs text-neutral-500">/ read</span>
      </div>
      <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        ≈ ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} / mo
        {subnote && <span className="text-neutral-400"> · {subnote}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return String(n);
}

// keep useMemo imported for tree-shake parity if we later memoize totals
void useMemo;
