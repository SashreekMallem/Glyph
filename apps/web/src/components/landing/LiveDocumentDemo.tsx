"use client";

/**
 * The headline interactive: a real document on the left, the embedded
 * structured payload on the right. Drag a slider to "edit" the document —
 * watch the JSON catch up in real time, with a drift indicator that
 * mirrors what the actual sync endpoint reports.
 *
 * No 3D here, just choreographed DOM + Framer Motion. Carries 90% of the
 * "this product is alive" signal at a fraction of the bundle weight of a
 * full WebGL scene.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

const NAMES = [
  "Ada Lovelace",
  "Ada Byron",
  "Grace Hopper",
  "Hedy Lamarr",
  "Katherine Johnson",
];

const TITLES = [
  "Lead Algorithmist",
  "Principal Engineer",
  "Computer Scientist",
  "Inventor",
  "Mathematician",
];

export function LiveDocumentDemo() {
  const [nameIdx, setNameIdx] = useState(0);
  const [titleIdx, setTitleIdx] = useState(0);

  const name = NAMES[nameIdx]!;
  const title = TITLES[titleIdx]!;

  const drifted = nameIdx !== 0 || titleIdx !== 0;

  const json = useMemo(
    () =>
      JSON.stringify(
        {
          personal: { full_name: name, title },
          experience: [{ company: "Analytical Engine Co.", years: "1843–1852" }],
          _meta: {
            fingerprints: { "personal.full_name": fakeFp(name), "personal.title": fakeFp(title) },
            schema_version: "1.0",
          },
        },
        null,
        2,
      ),
    [name, title],
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
      {/* Document panel */}
      <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:p-8">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
            resume.docx
          </span>
          <DriftBadge drifted={drifted} />
        </div>
        <h3 className="font-serif text-2xl leading-tight text-neutral-900 sm:text-3xl">
          <Highlightable changed={nameIdx !== 0}>{name}</Highlightable>
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          <Highlightable changed={titleIdx !== 0}>{title}</Highlightable>
        </p>
        <div className="mt-6 space-y-2 text-sm text-neutral-700">
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
            Experience
          </div>
          <div>
            <span className="font-medium text-neutral-900">Analytical Engine Co.</span>
            <span className="text-neutral-500"> — 1843–1852</span>
          </div>
          <p className="text-neutral-600">
            First algorithm intended for a machine. Notes on Bernoulli numbers.
          </p>
        </div>

        {/* Edit controls */}
        <div className="mt-8 space-y-3 border-t border-neutral-100 pt-6">
          <Picker
            label="Name"
            value={nameIdx}
            options={NAMES}
            onChange={setNameIdx}
          />
          <Picker
            label="Title"
            value={titleIdx}
            options={TITLES}
            onChange={setTitleIdx}
          />
        </div>
      </div>

      {/* JSON panel */}
      <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-950 p-6 text-neutral-200 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:p-8">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-500">
            embedded payload
          </span>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-emerald-400">
            ✓ signed
          </span>
        </div>
        <motion.pre
          key={json}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="overflow-x-auto font-mono text-[11px] leading-[1.55] text-neutral-300 sm:text-xs"
        >
          <code>{json}</code>
        </motion.pre>
        <div className="mt-6 flex items-center justify-between border-t border-neutral-800 pt-4">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-500">
            consumer cost
          </span>
          <span className="font-mono text-xs text-emerald-400">$0.00 · 2 ms</span>
        </div>
      </div>
    </div>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: string[];
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-16 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(i)}
            className={`rounded-full px-2.5 py-1 text-xs transition ${
              i === value
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function Highlightable({
  children,
  changed,
}: {
  children: React.ReactNode;
  changed: boolean;
}) {
  return (
    <span className="relative inline-block">
      <AnimatePresence>
        {changed && (
          <motion.span
            key="hl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 -z-10 h-[0.6em] rounded-sm bg-amber-200/70"
            aria-hidden
          />
        )}
      </AnimatePresence>
      {children}
    </span>
  );
}

function DriftBadge({ drifted }: { drifted: boolean }) {
  return (
    <AnimatePresence mode="wait">
      {drifted ? (
        <motion.span
          key="drift"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-amber-700"
        >
          drift · re-extracting
        </motion.span>
      ) : (
        <motion.span
          key="sync"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-emerald-700"
        >
          in sync
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Fake fingerprint just for the demo — real sha256 lives server-side. */
function fakeFp(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0") + "00000000";
}
