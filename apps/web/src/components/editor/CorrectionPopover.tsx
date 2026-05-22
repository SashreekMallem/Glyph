"use client";

/**
 * CorrectionPopover — Grammarly-style review surface for low-confidence
 * GLiNER2 spans.
 *
 * Anchored to the clicked span in the Tiptap editor. The user can:
 *   - Confirm  → tell the backend the original guess was correct.
 *   - Edit     → adjust label and/or value, then save.
 *   - Reject   → tell the backend "this isn't a field" and strip the mark.
 *
 * The popover does not own the mark. It calls `onAccept`/closes and lets
 * the editor commit the mark mutation, keeping ProseMirror state in one
 * place.
 */

import { useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

export type CorrectionDocType = "resume" | "contract" | "invoice";

export interface CorrectionAlternative {
  readonly label: string;
  readonly value: string;
}

export interface CorrectionPopoverProps {
  readonly open: boolean;
  readonly anchorEl: HTMLElement | null;
  readonly path: string;
  readonly currentValue: string;
  readonly currentLabel: string;
  readonly confidence: number;
  readonly alternatives?: readonly CorrectionAlternative[];
  readonly docId?: string;
  readonly docType: CorrectionDocType;
  readonly region: [number, number] | null;
  readonly sourceText: string;
  readonly onClose: () => void;
  readonly onAccept: (newValue: string, newLabel: string) => void;
  readonly onReject?: () => void;
}

type Mode = "view" | "edit";

// The backend (other agent) is wiring `appRouter.documents.submitCorrection`.
// We narrow the tRPC client to the shape we expect so typecheck flags any
// drift the moment the router is published.
interface SubmitCorrectionInput {
  docId?: string;
  docType: CorrectionDocType;
  path: string;
  originalValue: string;
  correctedValue: string;
  originalLabel: string;
  correctedLabel: string | null;
  confidence: number;
  regionStart: number | null;
  regionEnd: number | null;
  sourceText: string;
}

interface DocumentsRouterShape {
  submitCorrection: {
    useMutation: () => {
      mutate: (input: SubmitCorrectionInput) => void;
      isPending: boolean;
    };
  };
}

export function CorrectionPopover({
  open,
  anchorEl,
  path,
  currentValue,
  currentLabel,
  confidence,
  alternatives,
  docId,
  docType,
  region,
  sourceText,
  onClose,
  onAccept,
  onReject,
}: CorrectionPopoverProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [draftValue, setDraftValue] = useState(currentValue);
  const [draftLabel, setDraftLabel] = useState(currentLabel);
  const valueInputRef = useRef<HTMLInputElement | null>(null);
  // Radix Popover.Anchor reads positioning off this ref each frame; keeping
  // it in a ref (vs. inline literal) lets us swap the span without churning
  // the anchor identity.
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchorEl;

  // Reset local state whenever the popover re-anchors to a new span.
  useEffect(() => {
    if (!open) return;
    setMode("view");
    setDraftValue(currentValue);
    setDraftLabel(currentLabel);
  }, [open, currentValue, currentLabel, path]);

  useEffect(() => {
    if (mode === "edit") {
      valueInputRef.current?.focus();
      valueInputRef.current?.select();
    }
  }, [mode]);

  const mutation = (
    trpc as unknown as { documents: DocumentsRouterShape }
  ).documents.submitCorrection.useMutation();

  function submit(
    correctedValue: string,
    correctedLabel: string | null,
  ): void {
    mutation.mutate({
      docId,
      docType,
      path,
      originalValue: currentValue,
      correctedValue,
      originalLabel: currentLabel,
      correctedLabel,
      confidence,
      regionStart: region?.[0] ?? null,
      regionEnd: region?.[1] ?? null,
      sourceText,
    });
  }

  function handleConfirm(): void {
    // corrected === original signals "you got it right".
    submit(currentValue, currentLabel);
    onClose();
  }

  function handleReject(): void {
    // correctedLabel === null signals "not a field" — backend should drop it.
    submit(currentValue, null);
    onReject?.();
    onClose();
  }

  function handleSave(): void {
    const v = draftValue.trim();
    const l = draftLabel.trim();
    if (v.length === 0 || l.length === 0) return;
    submit(v, l);
    onAccept(v, l);
    onClose();
  }

  const confidencePct = Math.round(confidence * 100);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {anchorEl ? (
        <PopoverAnchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />
      ) : null}
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-80"
        onOpenAutoFocus={(e) => {
          // Don't steal focus away from the editor on first open.
          if (mode === "view") e.preventDefault();
        }}
      >
        <div className="flex flex-col gap-3">
          <header className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
              GLiNER2 suggestion
            </p>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {confidencePct}%
            </span>
          </header>

          <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
            {mode === "view" ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="w-14 text-[11px] uppercase tracking-[0.12em] text-neutral-500">
                    Label
                  </span>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {currentLabel || path}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="w-14 text-[11px] uppercase tracking-[0.12em] text-neutral-500">
                    Value
                  </span>
                  <span className="font-mono text-neutral-900 dark:text-neutral-100">
                    “{currentValue}”
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="glyph-corr-label" className="text-xs">
                    Label
                  </Label>
                  <Input
                    id="glyph-corr-label"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    placeholder={path}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="glyph-corr-value" className="text-xs">
                    Value
                  </Label>
                  <Input
                    ref={valueInputRef}
                    id="glyph-corr-value"
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSave();
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {alternatives && alternatives.length > 0 && mode === "view" ? (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">
                Alternatives
              </p>
              <div className="flex flex-wrap gap-1.5">
                {alternatives.map((alt) => (
                  <button
                    key={`${alt.label}:${alt.value}`}
                    type="button"
                    className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    onClick={() => {
                      submit(alt.value, alt.label);
                      onAccept(alt.value, alt.label);
                      onClose();
                    }}
                  >
                    {alt.label}: {alt.value}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <footer className="flex items-center justify-end gap-2 pt-1">
            {mode === "view" ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReject}
                  disabled={mutation.isPending}
                >
                  Reject
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMode("edit")}
                  disabled={mutation.isPending}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirm}
                  disabled={mutation.isPending}
                >
                  Confirm
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMode("view")}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={
                    mutation.isPending ||
                    draftValue.trim().length === 0 ||
                    draftLabel.trim().length === 0
                  }
                >
                  Save
                </Button>
              </>
            )}
          </footer>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default CorrectionPopover;
