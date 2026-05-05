"use client";

/**
 * Right-rail panel for the Tiptap editor — Lexical-style decorator UX.
 *
 * Decoupled from the legacy ExtractedFieldsPanel (which takes streaming
 * EASE) — this one takes a flat list, which the new editor produces from
 * the document's `_meta.fingerprints`.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export interface ExtractedField {
  readonly path: string;
  readonly value: string | number | boolean | null;
  readonly verified?: boolean;
  readonly missing?: boolean;
}

export interface FieldsPanelProps {
  readonly fields: readonly ExtractedField[];
  readonly editorRoot?: HTMLElement | null;
  readonly onJump?: (path: string) => void;
}

const PULSE_MS = 1200;

export function FieldsPanel({ fields, editorRoot, onJump }: FieldsPanelProps) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const reduced = useReducedMotion();

  const filtered = useMemo(() => {
    if (!deferredFilter) return fields;
    const f = deferredFilter.toLowerCase();
    return fields.filter(
      (it) =>
        it.path.toLowerCase().includes(f) ||
        String(it.value ?? "").toLowerCase().includes(f),
    );
  }, [deferredFilter, fields]);

  const groups = useMemo(() => groupByPrefix(filtered), [filtered]);

  function jump(path: string) {
    onJump?.(path);
    if (!editorRoot) return;
    const sel = `[data-glyph-field="${escapeForSelector(path)}"]`;
    const el = editorRoot.querySelector<HTMLElement>(sel);
    if (!el) return;
    el.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
    if (reduced) return;
    el.classList.remove("glyph-field-pulse");
    void el.offsetWidth;
    el.classList.add("glyph-field-pulse");
    setTimeout(() => el.classList.remove("glyph-field-pulse"), PULSE_MS);
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-neutral-400">
        Extracted fields · {fields.length}
      </p>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter…"
        className="mt-3 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 placeholder-neutral-400 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200"
      />

      {fields.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-4 space-y-4">
          {groups.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No matches for &ldquo;{deferredFilter}&rdquo;.
            </p>
          ) : (
            groups.map((g) => (
              <FieldGroup key={g.label} label={g.label} fields={g.fields} onJump={jump} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center dark:border-neutral-800">
      <p className="font-serif text-sm text-neutral-700 dark:text-neutral-300">
        No fields yet — start writing.
      </p>
      <p className="mt-1 text-[11px] text-neutral-400">
        Glyph reads as you type and lists every field here.
      </p>
    </div>
  );
}

function FieldGroup({
  label,
  fields,
  onJump,
}: {
  label: string;
  fields: ExtractedField[];
  onJump: (path: string) => void;
}) {
  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[0.6rem] uppercase tracking-[0.18em] text-neutral-400 marker:hidden">
        <span>{label}</span>
        <ChevronIcon />
      </summary>
      <ul className="mt-2 space-y-1.5">
        <AnimatePresence initial={false}>
          {fields.map((f) => (
            <FieldCard key={f.path} field={f} onJump={onJump} />
          ))}
        </AnimatePresence>
      </ul>
    </details>
  );
}

function FieldCard({
  field,
  onJump,
}: {
  field: ExtractedField;
  onJump: (path: string) => void;
}) {
  const isMissing = !!field.missing;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: "spring", stiffness: 250, damping: 22 }}
    >
      <button
        type="button"
        onClick={() => onJump(field.path)}
        className={`group/card relative w-full rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
          isMissing
            ? "border-amber-200/80 bg-amber-50/40 hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10"
            : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/50"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.18em] text-neutral-500">
            {field.path}
          </span>
          {field.verified ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-400">
              ✓ sig
            </span>
          ) : isMissing ? (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              missing
            </span>
          ) : null}
        </div>
        <div className="mt-1 truncate font-serif text-sm text-neutral-900 dark:text-neutral-50">
          {isMissing
            ? "—"
            : field.value === null || field.value === undefined
              ? "—"
              : String(field.value)}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-400">
          <span className="opacity-0 transition-opacity group-hover/card:opacity-100">
            in document
          </span>
          <ArrowJumpIcon />
        </div>
      </button>
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Group {
  readonly label: string;
  readonly fields: ExtractedField[];
}

function groupByPrefix(fields: readonly ExtractedField[]): Group[] {
  const map = new Map<string, ExtractedField[]>();
  for (const f of fields) {
    const segs = f.path.split(".");
    const label =
      segs.length >= 2 && /^\d+$/.test(segs[1] ?? "")
        ? `${segs[0]}.${segs[1]}`
        : (segs[0] ?? "root");
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(f);
  }
  return Array.from(map.entries())
    .map(([label, list]) => ({ label, fields: list }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function escapeForSelector(input: string): string {
  return input.replace(/(["\\])/g, "\\$1");
}

function ChevronIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform group-open:rotate-90"
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ArrowJumpIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-neutral-400 transition-transform group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5 group-hover/card:text-emerald-600"
      aria-hidden
    >
      <path d="M7 17l10-10M7 7h10v10" />
    </svg>
  );
}
