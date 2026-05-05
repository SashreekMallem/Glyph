"use client";

/**
 * Premium document card.
 *
 * Top: a CSS-3D miniature document — same family as the landing/auth
 * hero, sized down. It tilts toward the cursor on hover, casting a soft
 * shadow underneath. Pure CSS transforms, no WebGL.
 *
 * Below the preview: title, type chip, status pill (draft / signed),
 * mono micro-stat (last edited + read count). Hover reveals an actions
 * menu in the corner without competing with the card's primary affordance.
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DocLike {
  readonly id: string;
  readonly title: string;
  readonly documentType: string;
  readonly isFinalized: boolean;
  readonly updatedAt: string;
}

export interface DocumentCardProps {
  readonly doc: DocLike;
  readonly onDelete: (doc: DocLike) => void;
  /** Optional read count from the consumer-pays usage table. */
  readonly readCount?: number;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeFrom(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE.format(diffSec, "second");
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return RELATIVE.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return RELATIVE.format(Math.round(diffSec / 86400), "day");
  if (abs < 31536000)
    return RELATIVE.format(Math.round(diffSec / 2592000), "month");
  return RELATIVE.format(Math.round(diffSec / 31536000), "year");
}

export function DocumentCard({ doc, onDelete, readCount = 0 }: DocumentCardProps) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 220, damping: 18 });
  const sry = useSpring(ry, { stiffness: 220, damping: 18 });

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rx.set(-py * 8);
      ry.set(px * 12);
    };
    const onLeave = () => {
      rx.set(0);
      ry.set(0);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced, rx, ry]);

  return (
    <div
      ref={ref}
      className="group relative h-full"
      style={{ perspective: 1200 }}
    >
      <Link
        href={`/documents/${doc.id}`}
        className="block h-full focus:outline-none"
      >
        <motion.div
          style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d" }}
          className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_18px_36px_-18px_rgba(0,0,0,0.18)] dark:border-neutral-800 dark:bg-neutral-900"
        >
          <DocPreview doc={doc} />

          <div className="flex flex-1 flex-col gap-2 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[0.55rem] uppercase tracking-[0.22em] text-neutral-400">
                {doc.documentType}
              </span>
              <StatusPill finalized={doc.isFinalized} />
            </div>
            <h3 className="truncate font-serif text-lg leading-tight tracking-tight text-neutral-900 dark:text-neutral-50">
              {doc.title || "Untitled"}
            </h3>
            <div className="mt-auto flex items-center justify-between pt-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-neutral-400">
              <span>edited {relativeFrom(doc.updatedAt)}</span>
              <span>
                {readCount > 0
                  ? `${readCount.toLocaleString()} reads`
                  : "0 reads"}
              </span>
            </div>
          </div>
        </motion.div>
      </Link>

      <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full bg-white/85 backdrop-blur dark:bg-neutral-900/85"
              aria-label="Document actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(doc)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocPreview — the CSS-3D miniature document at the top of the card
// ---------------------------------------------------------------------------

function DocPreview({ doc }: { doc: DocLike }) {
  const lines = previewLinesFor(doc.documentType);
  return (
    <div className="relative h-32 overflow-hidden bg-gradient-to-br from-neutral-50 to-white dark:from-neutral-950 dark:to-neutral-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-200/30 blur-2xl" />
        <div className="absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-amber-100/40 blur-2xl" />
      </div>
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ transform: "translate(-50%, -50%) rotateZ(-3deg)" }}
      >
        <div
          className="rounded-md bg-[#fdfcfa] p-3 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(0,0,0,0.05)]"
          style={{ width: 156 }}
        >
          <div className="font-mono text-[6px] uppercase tracking-[0.22em] text-neutral-400">
            {doc.documentType}
          </div>
          <div className="mt-1.5 font-serif text-[10px] font-medium leading-tight text-neutral-900">
            {(doc.title || "Untitled").slice(0, 28)}
          </div>
          <div className="mt-2 space-y-1">
            {lines.map((w, i) => (
              <div
                key={i}
                className="h-[3px] rounded-full bg-neutral-300/80"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function previewLinesFor(type: string): number[] {
  switch (type) {
    case "resume":
      return [80, 60, 70, 90, 50, 75];
    case "contract":
      return [90, 85, 92, 70, 88, 60];
    case "invoice":
      return [60, 80, 50, 70];
    default:
      return [80, 70, 90, 60, 75];
  }
}

function StatusPill({ finalized }: { finalized: boolean }) {
  if (finalized) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
        ✓ signed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
      draft
    </span>
  );
}
