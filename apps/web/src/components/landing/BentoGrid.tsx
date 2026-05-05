"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Apple-style bento grid for feature highlights. Six tiles, varying spans.
 * Each tile lifts subtly on hover — the whole grid feels like one object
 * but each cell carries its own thought.
 */

interface Tile {
  readonly title: string;
  readonly body: string;
  readonly span?: string;
  readonly accent?: "default" | "dark" | "glow";
  readonly visual?: ReactNode;
}

const TILES: Tile[] = [
  {
    title: "One-shot extraction",
    body: "Author creates the document. Glyph extracts, signs, and embeds. The payload travels with the file forever.",
    span: "sm:col-span-2 sm:row-span-2",
    accent: "dark",
    visual: <PayloadGlyph />,
  },
  {
    title: "Self-healing sync",
    body: "Edited in plain Word? Drift detected by per-leaf fingerprints. Only changed fields are re-extracted — milliseconds of work, fractions of a cent.",
    span: "sm:col-span-2",
    visual: <DriftLine />,
  },
  {
    title: "Composable schema blocks",
    body: "21 curated atomic blocks. Compose any subset. Identical compositions share a SHA-256 fingerprint — same merged schema, free.",
  },
  {
    title: "$0 consumer reads",
    body: "Decrypt + verify ≈ 2 ms. Pure crypto. No LLM in the read path.",
    accent: "glow",
  },
  {
    title: "MCP-native",
    body: "Five tools out of the box: structure, validate, generate, read, discover. Drop into Claude, Cursor, any agent.",
    span: "sm:col-span-2",
    visual: <McpDots />,
  },
];

export function BentoGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:auto-rows-[12rem] sm:gap-4">
      {TILES.map((t, i) => (
        <motion.div
          key={t.title}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4, delay: i * 0.04 }}
          whileHover={{ y: -2 }}
          className={`group relative overflow-hidden rounded-2xl border p-6 transition-shadow sm:p-7 ${
            t.span ?? ""
          } ${
            t.accent === "dark"
              ? "border-neutral-900 bg-neutral-950 text-neutral-100"
              : t.accent === "glow"
                ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-neutral-900"
                : "border-neutral-200 bg-white text-neutral-900 hover:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06)]"
          }`}
        >
          <div className="relative z-10 flex h-full flex-col">
            <h3
              className={`font-serif text-lg leading-tight tracking-tight sm:text-xl ${
                t.accent === "dark" ? "text-white" : ""
              }`}
            >
              {t.title}
            </h3>
            <p
              className={`mt-2 max-w-md text-sm leading-relaxed ${
                t.accent === "dark" ? "text-neutral-400" : "text-neutral-600"
              }`}
            >
              {t.body}
            </p>
            {t.visual && <div className="mt-auto pt-6">{t.visual}</div>}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function PayloadGlyph() {
  return (
    <svg viewBox="0 0 240 120" className="h-32 w-full" aria-hidden>
      <rect x="20" y="14" width="120" height="92" rx="8" fill="#fff" opacity="0.05" />
      <rect x="34" y="34" width="80" height="6" rx="3" fill="#fff" opacity="0.5" />
      <rect x="34" y="48" width="50" height="4" rx="2" fill="#fff" opacity="0.3" />
      <rect x="34" y="60" width="70" height="4" rx="2" fill="#fff" opacity="0.3" />
      <rect x="34" y="72" width="60" height="4" rx="2" fill="#fff" opacity="0.3" />
      <rect
        x="160"
        y="28"
        width="64"
        height="64"
        rx="6"
        fill="#10b981"
        opacity="0.18"
      />
      <rect
        x="160"
        y="28"
        width="64"
        height="64"
        rx="6"
        fill="none"
        stroke="#10b981"
        strokeWidth="1"
      />
      <text
        x="192"
        y="64"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="10"
        fill="#10b981"
      >
        signed
      </text>
      <text
        x="192"
        y="78"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="10"
        fill="#10b981"
      >
        AES-256
      </text>
    </svg>
  );
}

function DriftLine() {
  return (
    <svg viewBox="0 0 280 60" className="h-12 w-full" aria-hidden>
      <line
        x1="0"
        y1="30"
        x2="280"
        y2="30"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 4"
        opacity="0.2"
      />
      {[40, 100, 160, 220].map((x, i) => (
        <g key={x}>
          <circle
            cx={x}
            cy="30"
            r={i === 1 ? 6 : 3}
            fill={i === 1 ? "#f59e0b" : "#10b981"}
          />
          <circle
            cx={x}
            cy="30"
            r={i === 1 ? 12 : 6}
            fill="none"
            stroke={i === 1 ? "#f59e0b" : "#10b981"}
            strokeWidth="1"
            opacity={i === 1 ? 0.3 : 0.15}
          />
        </g>
      ))}
      <text
        x="100"
        y="56"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="9"
        fill="#f59e0b"
      >
        drift
      </text>
    </svg>
  );
}

function McpDots() {
  const items = ["structure", "validate", "generate", "read", "discover"];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <span
          key={i}
          className="rounded-full bg-neutral-100 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-neutral-700"
        >
          {i}
        </span>
      ))}
    </div>
  );
}
