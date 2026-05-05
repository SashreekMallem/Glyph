"use client";

/**
 * Premium "New document" dialog.
 *
 * Design:
 *   - Glass-card backdrop, serif title, mono micro-labels on inputs
 *   - Type picker is three big visual cards (resume / contract /
 *     invoice), not a dropdown — each shows a tiny doc-mock + a verb
 *     description so the choice feels deliberate
 *   - Focus rings tinted emerald to match the rest of the app
 *   - Magnetic-hover Create button; spinner on pending; live error pill
 *
 * A11y: ships a real DialogDescription so screen readers know what the
 * modal is for, fixing the runtime warning we were emitting.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import type { DocType } from "@/components/editor/descriptors";

const DOC_TYPES: ReadonlyArray<{
  key: DocType;
  label: string;
  description: string;
  preview: readonly number[];
}> = [
  {
    key: "resume",
    label: "Resume",
    description: "Career history, signed and self-syncing.",
    preview: [80, 60, 70, 90, 50],
  },
  {
    key: "contract",
    label: "Contract",
    description: "Parties, terms, and provisions, embedded.",
    preview: [90, 85, 92, 70, 88],
  },
  {
    key: "invoice",
    label: "Invoice",
    description: "Line items and totals readers can verify.",
    preview: [60, 80, 50, 70],
  },
];

export function CreateDocDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocType>("resume");
  const utils = trpc.useUtils();
  const create = trpc.documents.create.useMutation({
    onSuccess: async (doc) => {
      await utils.documents.list.invalidate();
      onOpenChange(false);
      router.push(`/documents/${doc.id}`);
    },
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (title.trim().length === 0) return;
    create.mutate({ typeKey: type, title: title.trim() });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!create.isPending) onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg overflow-hidden border-neutral-200 bg-white p-0 dark:border-neutral-800 dark:bg-neutral-900">
        {/* Soft brand gradient header strip */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-50/60 via-white to-transparent dark:from-emerald-900/10 dark:via-neutral-900" />

        <div className="relative px-7 pb-6 pt-7">
          <DialogHeader className="space-y-1.5 text-left">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
              Workspace · New
            </p>
            <DialogTitle className="font-serif text-2xl tracking-tight text-neutral-900 dark:text-neutral-50">
              Start a new document.
            </DialogTitle>
            <DialogDescription className="text-sm text-neutral-500 dark:text-neutral-400">
              Pick a type and give it a title — Glyph reads, signs, and embeds
              the rest as you write.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="mt-6 space-y-5">
            <div className="grid gap-1.5">
              <Label
                htmlFor="title"
                className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500"
              >
                Title
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled"
                autoFocus
                className="h-11 border-neutral-200 bg-white text-[15px] focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-950"
              />
            </div>

            <div className="grid gap-2">
              <Label className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500">
                Type
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {DOC_TYPES.map((t) => (
                  <TypeCard
                    key={t.key}
                    label={t.label}
                    description={t.description}
                    preview={t.preview}
                    selected={type === t.key}
                    onSelect={() => setType(t.key)}
                  />
                ))}
              </div>
            </div>

            {create.error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
              >
                {create.error.message}
              </motion.div>
            )}

            <DialogFooter className="gap-2 pt-2 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
                className="h-10 px-4"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || title.trim().length === 0}
                className="group h-10 px-5"
              >
                <span className="flex items-center gap-2">
                  {create.isPending ? (
                    <>
                      <Spinner /> Creating
                    </>
                  ) : (
                    <>
                      Create document
                      <ArrowIcon />
                    </>
                  )}
                </span>
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// TypeCard — visual radio for the three built-in document types
// ---------------------------------------------------------------------------

function TypeCard({
  label,
  description,
  preview,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  preview: readonly number[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group/card relative flex flex-col items-stretch overflow-hidden rounded-xl border p-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 ${
        selected
          ? "border-emerald-300 bg-emerald-50/40 shadow-[0_4px_18px_-8px_rgba(16,185,129,0.35)] dark:border-emerald-900/60 dark:bg-emerald-900/10"
          : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      }`}
    >
      {/* Mini doc */}
      <div className="relative h-14 w-full overflow-hidden rounded-md bg-gradient-to-br from-neutral-50 to-white p-1.5 dark:from-neutral-950 dark:to-neutral-900">
        <div
          className="rounded-sm bg-[#fdfcfa] p-1 shadow-[0_4px_8px_-4px_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(0,0,0,0.05)]"
          style={{ width: "70%", margin: "0 auto" }}
        >
          {preview.map((w, i) => (
            <div
              key={i}
              className="mb-0.5 h-[2px] rounded-full bg-neutral-300/80 last:mb-0"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2.5 font-serif text-[14px] tracking-tight text-neutral-900 dark:text-neutral-50">
        {label}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-neutral-500">
        {description}
      </div>
      {selected && (
        <span className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] text-white">
          ✓
        </span>
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.36-8.6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform group-hover:translate-x-0.5"
      aria-hidden
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
