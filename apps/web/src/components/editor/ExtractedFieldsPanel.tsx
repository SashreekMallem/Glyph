"use client";

import * as React from "react";
import { useMemo, useState, type ReactNode } from "react";

export interface ExtractedFieldsPanelProps {
  readonly ease: Record<string, unknown> | null;
  readonly isStreaming?: boolean;
  readonly activeField?: string | null;
  readonly onFieldHover?: (path: string | null) => void;
}

// ---------------------------------------------------------------------------
// Dynamic color palette — assigned by insertion order, not by key name
// ---------------------------------------------------------------------------

const PALETTE = [
  { bg: "bg-violet-50",  border: "border-violet-300", dot: "bg-violet-400",  label: "text-violet-700",  css: "rgba(139,92,246,0.12)"  },
  { bg: "bg-sky-50",     border: "border-sky-300",    dot: "bg-sky-400",     label: "text-sky-700",     css: "rgba(14,165,233,0.12)"  },
  { bg: "bg-amber-50",   border: "border-amber-300",  dot: "bg-amber-400",   label: "text-amber-700",   css: "rgba(245,158,11,0.12)"  },
  { bg: "bg-emerald-50", border: "border-emerald-300",dot: "bg-emerald-400", label: "text-emerald-700", css: "rgba(16,185,129,0.12)"  },
  { bg: "bg-rose-50",    border: "border-rose-300",   dot: "bg-rose-400",    label: "text-rose-700",    css: "rgba(244,63,94,0.12)"   },
  { bg: "bg-orange-50",  border: "border-orange-300", dot: "bg-orange-400",  label: "text-orange-700",  css: "rgba(249,115,22,0.12)"  },
  { bg: "bg-teal-50",    border: "border-teal-300",   dot: "bg-teal-400",    label: "text-teal-700",    css: "rgba(20,184,166,0.12)"  },
  { bg: "bg-indigo-50",  border: "border-indigo-300", dot: "bg-indigo-400",  label: "text-indigo-700",  css: "rgba(99,102,241,0.12)"  },
];

// Stable map so colors don't shuffle on re-render
const colorCache = new Map<string, typeof PALETTE[0]>();
let colorIndex = 0;

function colorFor(topKey: string) {
  if (!colorCache.has(topKey)) {
    colorCache.set(topKey, PALETTE[colorIndex % PALETTE.length]!);
    colorIndex++;
  }
  return colorCache.get(topKey)!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isEaseContainer(
  v: unknown,
): v is { __ease__: true; display_order: string[]; [k: string]: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (v as Record<string, unknown>).__ease__ === true &&
    Array.isArray((v as Record<string, unknown>).display_order)
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !isEaseContainer(v);
}

export function humanizeKey(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  const out: string[] = [];
  for (const part of parts) {
    if (part === "__ease__" || part === "display_order") continue;
    const m = /^item_(\d+)$/.exec(part);
    if (m) { out.push(`#${parseInt(m[1]!, 10)}`); continue; }
    out.push(humanizeWord(part));
  }
  return out.join(" · ");
}

function humanizeWord(s: string): string {
  return s.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function unwrapAnnotated(v: unknown): unknown {
  if (isPlainObject(v) && "value" in v && ("text_span" in v || Object.keys(v).length <= 2)) {
    const inner = (v as Record<string, unknown>).value;
    if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") return inner;
  }
  return v;
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function formatValue(v: string | number | boolean): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

// ---------------------------------------------------------------------------
// Collect flat field list grouped by top-level key
// ---------------------------------------------------------------------------

interface FieldEntry {
  topKey: string;
  subPath: string;
  label: string;
  value: string;
}

function collectFields(ease: Record<string, unknown>): Map<string, FieldEntry[]> {
  const groups = new Map<string, FieldEntry[]>();

  function addEntry(topKey: string, subPath: string, value: string) {
    if (!groups.has(topKey)) groups.set(topKey, []);
    groups.get(topKey)!.push({ topKey, subPath, label: humanizeKey(subPath), value });
  }

  function walkValue(v: unknown, topKey: string, path: string) {
    const u = unwrapAnnotated(v);
    if (u === null || u === undefined) return;
    if (isPrimitive(u)) { addEntry(topKey, path, formatValue(u)); return; }
    if (Array.isArray(u)) {
      u.forEach((child, i) => walkValue(child, topKey, `${path}/${i}`));
      return;
    }
    if (isEaseContainer(u)) {
      u.display_order.forEach((key) => walkValue(u[key], topKey, `${path}/${key}`));
      return;
    }
    if (isPlainObject(u)) {
      Object.entries(u).filter(([k]) => k !== "__ease__" && k !== "display_order")
        .forEach(([k, child]) => walkValue(child, topKey, `${path}/${k}`));
    }
  }

  for (const [topKey, val] of Object.entries(ease)) {
    if (topKey === "__ease__" || topKey === "display_order") continue;
    walkValue(val, topKey, topKey);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Field group card
// ---------------------------------------------------------------------------

function FieldGroupCard({
  topKey,
  entries,
  isActive,
  onHover,
}: {
  topKey: string;
  entries: FieldEntry[];
  isActive: boolean;
  onHover: (key: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const color = colorFor(topKey);

  return (
    <div
      className={`rounded-lg border transition-all duration-150 ${color.border} ${isActive ? color.bg : "bg-white"} overflow-hidden`}
      onMouseEnter={() => onHover(topKey)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${color.dot}`} />
          <span className={`text-[0.7rem] font-semibold uppercase tracking-widest ${color.label}`}>
            {humanizeWord(topKey)}
          </span>
          <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[0.6rem] text-neutral-400">
            {entries.length}
          </span>
        </div>
        <svg
          className={`h-3 w-3 text-neutral-400 transition-transform ${expanded ? "" : "-rotate-90"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Rows */}
      {expanded && (
        <div className="divide-y divide-neutral-100 border-t border-neutral-100">
          {entries.map((entry) => (
            <div key={entry.subPath} className="flex items-start gap-2 px-3 py-1.5">
              <span className="min-w-0 shrink-0 font-mono text-[0.6rem] text-neutral-400 pt-0.5 w-24 truncate" title={entry.label}>
                {entry.label}
              </span>
              <span className="min-w-0 flex-1 text-[0.72rem] text-neutral-700 leading-snug break-words line-clamp-2">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ExtractedFieldsPanel({
  ease,
  isStreaming = false,
  activeField = null,
  onFieldHover,
}: ExtractedFieldsPanelProps) {
  const groups = useMemo(() => {
    if (!ease) return new Map<string, FieldEntry[]>();
    return collectFields(ease);
  }, [ease]);

  const isEmpty = groups.size === 0;

  const handleHover = (key: string | null) => {
    onFieldHover?.(key);
  };

  return (
    <div className="space-y-2">
      {/* Status bar */}
      <div className="flex items-center justify-between pb-1">
        <span className="text-[0.65rem] uppercase tracking-widest text-neutral-400">
          Extracted Fields
        </span>
        {isStreaming && (
          <span className="flex items-center gap-1 text-[0.6rem] text-emerald-600">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Live
          </span>
        )}
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center">
          <p className="text-[0.7rem] text-neutral-400">Start typing — fields appear here as Gemini identifies them.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(groups.entries()).map(([topKey, entries]) => (
            <FieldGroupCard
              key={topKey}
              topKey={topKey}
              entries={entries}
              isActive={activeField === topKey}
              onHover={handleHover}
            />
          ))}
        </div>
      )}
    </div>
  );
}
