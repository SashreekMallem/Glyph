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



export function CreateDocDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type] = useState<DocType>("custom");
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
