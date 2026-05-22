"use client";

/**
 * Premium "New document" dialog.
 *
 * Sections (top → bottom):
 *   1. Doc-type picker — four cards (Resume / Contract / Invoice / Custom).
 *   2. Custom-only — free-text description that drives schema synthesis
 *      via POST /api/v1/schemas/from-description.
 *   3. Starting mode — Blank document OR Upload a .docx (drop-zone).
 *   4. Title input.
 *
 * Submission paths:
 *   - Built-in type + Blank → trpc documents.create
 *   - Custom + Blank        → synthesize schema, then documents.create
 *   - Any type + Upload     → (synthesize if Custom), then POST multipart
 *                             to /api/v1/documents/import-docx
 *
 * A11y: ships a real DialogDescription so screen readers know what the
 * modal is for, fixing the runtime warning we were emitting.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FileText, Receipt, ScrollText, Sparkles, Upload, X } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type BuiltinType = "resume" | "contract" | "invoice";
type PickedType = BuiltinType | "custom";
type StartMode = "blank" | "upload";

type SynthResponse = { typeKey: string };
type SynthError = { error: { code?: string; message: string } };
type ImportDocxResponse = { docId: string };

type TypeOption = {
  key: PickedType;
  label: string;
  blurb: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const TYPE_OPTIONS: readonly TypeOption[] = [
  {
    key: "resume",
    label: "Resume",
    blurb: "Career timeline, skills, education.",
    Icon: FileText,
  },
  {
    key: "contract",
    label: "Contract",
    blurb: "Parties, terms, signatures.",
    Icon: ScrollText,
  },
  {
    key: "invoice",
    label: "Invoice",
    blurb: "Header, line items, totals.",
    Icon: Receipt,
  },
  {
    key: "custom",
    label: "Custom",
    blurb: "Describe it — Glyph builds the schema.",
    Icon: Sparkles,
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
  const utils = trpc.useUtils();

  const [type, setType] = useState<PickedType | null>(null);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<StartMode>("blank");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [title, setTitle] = useState("");
  // styleProfileId === "" means "no profile" → server falls back to the
  // built-in GLYPH_MODERN_PROFILE. We initialize this to the user's
  // current default once the list query resolves (effect below).
  const [styleProfileId, setStyleProfileId] = useState<string>("");

  // Pre-populate the picker with the user's default brand profile so a
  // freshly opened dialog reflects what they'd want by default. List is
  // small and cached, so this is essentially free.
  const styleProfilesQuery = trpc.styleProfiles.list.useQuery();
  useEffect(() => {
    if (!open || styleProfileId !== "") return;
    const defaultProfile = (styleProfilesQuery.data ?? []).find(
      (p) => p.isDefault,
    );
    if (defaultProfile) setStyleProfileId(defaultProfile.id);
  }, [open, styleProfileId, styleProfilesQuery.data]);

  // Async pipeline state. We orchestrate up to three calls (synth →
  // create | import-docx) so we cannot rely on a single mutation flag.
  const [phase, setPhase] = useState<
    "idle" | "synthesizing" | "creating" | "uploading"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const create = trpc.documents.create.useMutation();

  const busy = phase !== "idle";

  const reset = useCallback(() => {
    setType(null);
    setDescription("");
    setMode("blank");
    setFile(null);
    setDragOver(false);
    setTitle("");
    setStyleProfileId("");
    setPhase("idle");
    setError(null);
  }, []);

  const closeAndReset = useCallback(
    (v: boolean) => {
      if (busy) return;
      onOpenChange(v);
      if (!v) reset();
    },
    [busy, onOpenChange, reset],
  );

  const synthesizeTypeKey = useCallback(async (): Promise<string> => {
    setPhase("synthesizing");
    const res = await fetch("/api/v1/schemas/from-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ description: description.trim() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as SynthError | null;
      throw new Error(
        body?.error?.message ?? `Schema synthesis failed (${res.status}).`,
      );
    }
    const data = (await res.json()) as SynthResponse;
    if (!data.typeKey) {
      throw new Error("Schema synthesis returned no typeKey.");
    }
    return data.typeKey;
  }, [description]);

  const uploadDocx = useCallback(
    async (typeKey: string, picked: File): Promise<string> => {
      setPhase("uploading");
      const form = new FormData();
      form.append("file", picked);
      form.append("typeKey", typeKey);
      form.append("title", title.trim());
      // The import endpoint isn't styleProfile-aware yet — once the
      // doc is created the editor's StyleSwitcher can apply a profile.
      // Forwarding the id here keeps the contract forward-compatible.
      if (styleProfileId) form.append("styleProfileId", styleProfileId);
      const res = await fetch("/api/v1/documents/import-docx", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as SynthError | null;
        throw new Error(
          body?.error?.message ?? `Upload failed (${res.status}).`,
        );
      }
      const data = (await res.json()) as ImportDocxResponse;
      if (!data.docId) throw new Error("Import returned no docId.");
      return data.docId;
    },
    [title, styleProfileId],
  );

  const createBlank = useCallback(
    async (typeKey: string): Promise<string> => {
      setPhase("creating");
      const doc = await create.mutateAsync({
        typeKey,
        title: title.trim(),
        styleProfileId: styleProfileId === "" ? undefined : styleProfileId,
      });
      return doc.id;
    },
    [create, title, styleProfileId],
  );

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setError(null);

    if (!type) {
      setError("Pick a document type to continue.");
      return;
    }
    if (title.trim().length === 0) {
      setError("Give the document a title.");
      return;
    }
    if (type === "custom" && description.trim().length === 0) {
      setError("Describe what you're writing so Glyph can build a schema.");
      return;
    }
    if (mode === "upload" && !file) {
      setError("Choose a .docx file to upload.");
      return;
    }

    try {
      const resolvedTypeKey =
        type === "custom" ? await synthesizeTypeKey() : type;

      let navigateId: string;
      if (mode === "upload") {
        // `file` is non-null per the guard above; reassert for TS.
        if (!file) throw new Error("Missing file.");
        navigateId = await uploadDocx(resolvedTypeKey, file);
      } else {
        navigateId = await createBlank(resolvedTypeKey);
      }

      await utils.documents.list.invalidate();
      onOpenChange(false);
      reset();
      router.push(`/documents/${navigateId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("idle");
    }
  };

  // --- File-drop handlers ------------------------------------------------
  const onPickFile = (f: File | null) => {
    if (!f) {
      setFile(null);
      return;
    }
    if (!f.name.toLowerCase().endsWith(".docx")) {
      setError("Only .docx files are supported.");
      return;
    }
    setError(null);
    setFile(f);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    onPickFile(f);
  };

  // --- Render ------------------------------------------------------------
  const buttonLabel = (() => {
    if (phase === "synthesizing") return "Generating schema";
    if (phase === "uploading") return "Uploading";
    if (phase === "creating") return "Creating";
    return "Create document";
  })();

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent className="max-w-xl overflow-hidden border-neutral-200 bg-white p-0 dark:border-neutral-800 dark:bg-neutral-900">
        {/* Soft brand gradient header strip */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-50/60 via-white to-transparent dark:from-emerald-900/10 dark:via-neutral-900" />

        <div className="relative max-h-[85vh] overflow-y-auto px-7 pb-6 pt-7">
          <DialogHeader className="space-y-1.5 text-left">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
              Workspace · New
            </p>
            <DialogTitle className="font-serif text-2xl tracking-tight text-neutral-900 dark:text-neutral-50">
              Start a new document.
            </DialogTitle>
            <DialogDescription className="text-sm text-neutral-500 dark:text-neutral-400">
              Pick a type, choose how to start, and give it a title — Glyph
              embeds the structured payload as you write.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="mt-6 space-y-6">
            {/* Section 1 — type picker ------------------------------- */}
            <fieldset className="grid gap-2">
              <Label className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500">
                Type
              </Label>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {TYPE_OPTIONS.map((opt) => {
                  const selected = type === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setType(opt.key)}
                      disabled={busy}
                      aria-pressed={selected}
                      className={cn(
                        "group relative flex flex-col items-start gap-2 rounded-lg border bg-white p-3 text-left transition-all dark:bg-neutral-950",
                        selected
                          ? "border-emerald-300 ring-2 ring-emerald-500/30 dark:border-emerald-500/40"
                          : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900",
                        busy && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <opt.Icon
                        className={cn(
                          "h-4 w-4 transition-colors",
                          selected
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-neutral-500 dark:text-neutral-400",
                        )}
                      />
                      <div className="space-y-0.5">
                        <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                          {opt.label}
                        </div>
                        <div className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                          {opt.blurb}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Section 2 — custom description ------------------------ */}
            {type === "custom" && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid gap-1.5"
              >
                <Label
                  htmlFor="describe"
                  className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500"
                >
                  Describe what you&apos;re writing
                </Label>
                <Textarea
                  id="describe"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Veterinary visit record for a small animal clinic"
                  disabled={busy}
                  className="border-neutral-200 bg-white text-[14px] focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-950"
                />
                <p className="text-[11px] text-neutral-400">
                  Glyph generates a JSON schema from this description.
                </p>
              </motion.div>
            )}

            {/* Section 3 — starting mode ----------------------------- */}
            <fieldset className="grid gap-2">
              <Label className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500">
                Start from
              </Label>
              <div className="grid grid-cols-2 gap-2.5">
                <ModeRadio
                  checked={mode === "blank"}
                  label="Blank document"
                  hint="Start from an empty canvas."
                  disabled={busy}
                  onSelect={() => setMode("blank")}
                />
                <ModeRadio
                  checked={mode === "upload"}
                  label="Upload a .docx file"
                  hint="Import an existing Word document."
                  disabled={busy}
                  onSelect={() => setMode("upload")}
                />
              </div>

              {mode === "upload" && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-1"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-500/30 dark:bg-emerald-900/10">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="truncate text-[13px] text-neutral-800 dark:text-neutral-100">
                          {file.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-neutral-500">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onPickFile(null)}
                        disabled={busy}
                        aria-label="Remove file"
                        className="rounded-full p-1 text-neutral-500 hover:bg-white hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => !busy && fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!busy) setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => !busy && onDrop(e)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (!busy) fileInputRef.current?.click();
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
                        dragOver
                          ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-900/10"
                          : "border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900",
                        busy && "pointer-events-none opacity-60",
                      )}
                    >
                      <Upload className="h-4 w-4 text-neutral-500" />
                      <p className="text-[13px] text-neutral-700 dark:text-neutral-300">
                        Drop a <span className="font-mono">.docx</span> here, or
                        click to browse
                      </p>
                      <p className="text-[11px] text-neutral-400">
                        Word format only · 25&nbsp;MB max
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </fieldset>

            {/* Section 4 — title ------------------------------------- */}
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
                disabled={busy}
                className="h-11 border-neutral-200 bg-white text-[15px] focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-950"
              />
            </div>

            {/* Section 5 — brand profile ----------------------------- */}
            <div className="grid gap-1.5">
              <Label
                htmlFor="style-profile"
                className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500"
              >
                Apply style profile
              </Label>
              <div className="relative">
                <select
                  id="style-profile"
                  value={styleProfileId}
                  onChange={(e) => setStyleProfileId(e.target.value)}
                  disabled={busy}
                  className="h-10 w-full cursor-pointer appearance-none rounded-md border border-neutral-200 bg-white pl-3 pr-8 text-sm text-neutral-900 focus-visible:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                >
                  <option value="">Glyph Modern (default)</option>
                  {(styleProfilesQuery.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.profile.name}
                      {p.isDefault ? " · default" : ""}
                    </option>
                  ))}
                </select>
                <svg
                  aria-hidden
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
              <p className="text-[11px] text-neutral-400">
                Manage profiles in{" "}
                <span className="font-mono">Settings → Style</span>.
              </p>
            </div>

            {(error || create.error) && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
              >
                {error ?? create.error?.message}
              </motion.div>
            )}

            <DialogFooter className="gap-2 pt-1 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => closeAndReset(false)}
                disabled={busy}
                className="h-10 px-4"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !type || title.trim().length === 0}
                className="group h-10 px-5"
              >
                <span className="flex items-center gap-2">
                  {busy ? (
                    <>
                      <Spinner /> {buttonLabel}
                    </>
                  ) : (
                    <>
                      {buttonLabel}
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

function ModeRadio({
  checked,
  label,
  hint,
  disabled,
  onSelect,
}: {
  checked: boolean;
  label: string;
  hint: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border bg-white p-3 text-left transition-all dark:bg-neutral-950",
        checked
          ? "border-emerald-300 ring-2 ring-emerald-500/30 dark:border-emerald-500/40"
          : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
          checked
            ? "border-emerald-500 bg-emerald-500"
            : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950",
        )}
        aria-hidden
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          {label}
        </span>
        <span className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
          {hint}
        </span>
      </span>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
