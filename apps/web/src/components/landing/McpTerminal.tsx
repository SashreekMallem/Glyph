"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * Faux terminal that types out an MCP call + response. Loops every ~12s.
 * Auto-pauses if the user prefers reduced motion.
 */

const SCRIPT: Array<{ kind: "in" | "out" | "meta"; text: string; delay?: number }> = [
  { kind: "meta", text: "$ claude mcp call read_glyph_payload" },
  { kind: "in", text: '{ "format": "docx", "content": "<base64...>", "api_key": "sk_live_***" }' },
  { kind: "meta", text: "→ glyph-mcp-server", delay: 200 },
  { kind: "out", text: '{' },
  { kind: "out", text: '  "verified": true,' },
  { kind: "out", text: '  "status":   "in_sync",' },
  { kind: "out", text: '  "data":     { "personal": { "full_name": "Ada Lovelace" }, ... },' },
  { kind: "out", text: '  "drift":    null,' },
  { kind: "out", text: '  "block_ids":["resume.base.v1","resume.experience.v1"]' },
  { kind: "out", text: '}' },
  { kind: "meta", text: "✓ 2 ms · $0.00", delay: 400 },
];

export function McpTerminal() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        setStep(SCRIPT.length);
        return;
      }
    }
    if (step >= SCRIPT.length) {
      const t = setTimeout(() => setStep(0), 4500);
      return () => clearTimeout(t);
    }
    const delay = SCRIPT[step]?.delay ?? 380;
    const t = setTimeout(() => setStep((s) => s + 1), delay);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
        </div>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-500">
          mcp · stdio
        </span>
        <span className="w-12" />
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[11px] leading-[1.7] text-neutral-300 sm:p-6 sm:text-xs">
        {SCRIPT.slice(0, step).map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
            className={
              line.kind === "in"
                ? "text-sky-300"
                : line.kind === "out"
                  ? "text-neutral-200"
                  : "text-neutral-500"
            }
          >
            {line.text}
          </motion.div>
        ))}
        {step < SCRIPT.length && (
          <motion.span
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ repeat: Infinity, duration: 1 }}
            className="text-neutral-300"
          >
            ▌
          </motion.span>
        )}
      </pre>
    </div>
  );
}
