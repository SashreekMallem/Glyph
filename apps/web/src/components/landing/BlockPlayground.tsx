"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Live schema-block playground.
 *
 * The same composability that powers Glyph internally, sandboxed for
 * marketing. Click blocks to add/remove; the merged JSON Schema and the
 * SHA-256 fingerprint update live. Identical compositions hit the
 * "cache" with a visible reuseCount.
 *
 * Pure browser code — uses Web Crypto for the fingerprint, no network.
 */

interface BlockDef {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly required?: boolean;
  readonly schema: Record<string, unknown>;
}

const BLOCKS: BlockDef[] = [
  {
    id: "resume.base.v1",
    title: "Base",
    description: "identity, contact, summary",
    required: true,
    schema: {
      type: "object",
      properties: {
        full_name: { type: "string" },
        email: { type: "string", format: "email" },
        summary: { type: "string" },
      },
      required: ["full_name"],
    },
  },
  {
    id: "resume.experience.v1",
    title: "Experience",
    description: "jobs with company, title, dates",
    required: true,
    schema: {
      type: "object",
      properties: {
        experience: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              title: { type: "string" },
              start_date: { type: "string", format: "date" },
              end_date: { type: "string", format: "date" },
              description: { type: "string" },
            },
            required: ["company", "title"],
          },
        },
      },
      required: ["experience"],
    },
  },
  {
    id: "resume.education.v1",
    title: "Education",
    description: "schools, degrees, fields",
    required: true,
    schema: {
      type: "object",
      properties: {
        education: {
          type: "array",
          items: {
            type: "object",
            properties: {
              institution: { type: "string" },
              degree: { type: "string" },
              field: { type: "string" },
              graduation_year: { type: "number" },
            },
          },
        },
      },
    },
  },
  {
    id: "resume.skills.v1",
    title: "Skills",
    description: "tagged skill list",
    schema: {
      type: "object",
      properties: {
        skills: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    id: "resume.projects.v1",
    title: "Projects",
    description: "portfolio items",
    schema: {
      type: "object",
      properties: {
        projects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              url: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    id: "resume.publications.v1",
    title: "Publications",
    description: "papers with venue + date",
    schema: {
      type: "object",
      properties: {
        publications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              venue: { type: "string" },
              date: { type: "string", format: "date" },
            },
          },
        },
      },
    },
  },
  {
    id: "resume.languages.v1",
    title: "Languages",
    description: "spoken languages with fluency",
    schema: {
      type: "object",
      properties: {
        languages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              language: { type: "string" },
              fluency: {
                type: "string",
                enum: ["basic", "conversational", "fluent", "native"],
              },
            },
          },
        },
      },
    },
  },
  {
    id: "resume.certifications.v1",
    title: "Certifications",
    description: "issued credentials",
    schema: {
      type: "object",
      properties: {
        certifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              issuer: { type: "string" },
              issued_at: { type: "string", format: "date" },
            },
          },
        },
      },
    },
  },
];

const REQUIRED_IDS = BLOCKS.filter((b) => b.required).map((b) => b.id);

export function BlockPlayground() {
  const [selected, setSelected] = useState<string[]>(REQUIRED_IDS);
  const [fingerprint, setFingerprint] = useState<string>("computing…");
  const [flash, setFlash] = useState(false);
  const seenRef = useRef<Map<string, number>>(new Map());
  const [reuseCount, setReuseCount] = useState<number | null>(null);

  // Merge selected blocks' schemas
  const merged = useMemo(() => mergeSchemas(selected), [selected]);

  // Recompute fingerprint when selection changes
  useEffect(() => {
    let cancelled = false;
    const sortedKey = [...selected].sort().join(":");
    let timer: ReturnType<typeof setTimeout> | null = null;
    sha256First12(sortedKey).then((hex) => {
      if (cancelled) return;
      setFingerprint(hex);
      const prev = seenRef.current.get(hex) ?? 0;
      seenRef.current.set(hex, prev + 1);
      setReuseCount(prev + 1);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) {
        setFlash(true);
        timer = setTimeout(() => setFlash(false), 500);
      }
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selected]);

  const toggle = (id: string) => {
    if (REQUIRED_IDS.includes(id)) return;
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
      {/* Palette */}
      <div className="lg:col-span-3">
        <div className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
          Block library · click to compose
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BLOCKS.map((b) => {
            const active = selected.includes(b.id);
            const required = !!b.required;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggle(b.id)}
                className={`group relative flex flex-col items-start rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-900/10"
                    : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
                } ${required ? "cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-serif text-base text-neutral-900 dark:text-neutral-50">
                    {b.title}
                  </span>
                  {required ? (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.15em] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                      required
                    </span>
                  ) : active ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-400">
                      added
                    </span>
                  ) : null}
                </div>
                <span className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-neutral-400">
                  {b.id}
                </span>
                <span className="mt-2 text-[12px] text-neutral-600 dark:text-neutral-400">
                  {b.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live output */}
      <div className="space-y-3 lg:col-span-2">
        {/* Selected chips */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
            Selected blocks
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AnimatePresence initial={false}>
              {selected.map((id) => {
                const b = BLOCKS.find((x) => x.id === id);
                if (!b) return null;
                return (
                  <motion.span
                    key={id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ type: "spring", stiffness: 250, damping: 20 }}
                    className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-white dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    {b.title}
                    {!b.required && (
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        aria-label={`Remove ${b.title}`}
                        className="opacity-60 hover:opacity-100"
                      >
                        ✕
                      </button>
                    )}
                  </motion.span>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Merged schema */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-500">
            Merged JSON Schema
          </div>
          <pre className="mt-2 max-h-[360px] overflow-auto font-mono text-[10.5px] leading-[1.55]">
            <code dangerouslySetInnerHTML={{ __html: highlightJson(merged) }} />
          </pre>
        </div>

        {/* Fingerprint */}
        <motion.div
          animate={
            flash
              ? { boxShadow: "0 0 0 6px rgba(16,185,129,0.12)" }
              : { boxShadow: "0 0 0 0 rgba(16,185,129,0)" }
          }
          transition={{ duration: 0.5 }}
          className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-neutral-400">
                Composition fingerprint
              </div>
              <div className="mt-1 font-mono text-sm text-neutral-900 dark:text-neutral-50">
                {fingerprint}
              </div>
            </div>
            {reuseCount !== null && reuseCount > 1 && (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-400">
                cache hit · reuseCount: {reuseCount}
              </span>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mergeSchemas(ids: string[]): Record<string, unknown> {
  const out: { type: "object"; properties: Record<string, unknown>; required: string[] } = {
    type: "object",
    properties: {},
    required: [],
  };
  for (const id of ids) {
    const b = BLOCKS.find((x) => x.id === id);
    if (!b) continue;
    const s = b.schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    if (s.properties) Object.assign(out.properties, s.properties);
    if (s.required) {
      for (const r of s.required) if (!out.required.includes(r)) out.required.push(r);
    }
  }
  return out;
}

async function sha256First12(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return "no-crypto";
  }
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const bytes = Array.from(new Uint8Array(buf));
  return bytes
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function highlightJson(obj: unknown): string {
  const json = JSON.stringify(obj, null, 2);
  // Escape HTML, then color tokens with span tags.
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(
      /"([^"]+)":/g,
      '<span style="color:#a3e635">"$1"</span>:',
    )
    .replace(
      /: "([^"]*)"/g,
      ': <span style="color:#fcd34d">"$1"</span>',
    )
    .replace(
      /\b(true|false|null)\b/g,
      '<span style="color:#fb923c">$1</span>',
    )
    .replace(
      /: (\d+)/g,
      ': <span style="color:#67e8f9">$1</span>',
    );
}
