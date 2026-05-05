"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { TiptapEditor } from "@/components/editor/TiptapEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn, FadeInUp } from "@/components/motion/primitives";

export default function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const docQuery = trpc.documents.get.useQuery({ id });
  const doc = docQuery.data;

  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);

  const initialHtml = useMemo(() => {
    if (!doc?.validatedJson) return "";
    return jsonToInitialHtml(doc.validatedJson);
  }, [doc?.validatedJson]);

  useEffect(() => {
    if (doc) setTitle(doc.title);
  }, [doc]);

  const save = trpc.documents.save.useMutation({
    onSuccess: () => {
      void utils.documents.list.invalidate();
    },
  });
  const [finalizeError, setFinalizeError] = useState<{
    readonly message: string;
    readonly issues?: readonly { path: readonly (string | number)[]; message: string }[];
  } | null>(null);
  const finalize = trpc.documents.finalize.useMutation({
    onSuccess: async () => {
      setFinalizeError(null);
      await utils.documents.get.invalidate({ id });
      await utils.documents.list.invalidate();
    },
    onError: (err) => {
      // tRPC ZodError is serialized into err.data.zodError; fall back to
      // err.message for non-validation failures.
      const data = (err.data as { zodError?: unknown } | null | undefined) ?? null;
      const issues = extractIssues(data?.zodError);
      setFinalizeError({ message: err.message, issues });
    },
  });
  const exportPdf = trpc.documents.exportPdf.useMutation({
    onSuccess: (data) => {
      if (typeof window !== "undefined") {
        window.open(data.url, "_blank");
      }
    },
  });

  const handleChange = useCallback(
    (json: object) => {
      if (!doc) return;
      save.mutate({
        id: doc.id,
        prosemirrorState: null,
        validatedJson: json as Record<string, unknown>,
      });
    },
    [doc, save],
  );

  if (docQuery.isLoading || !doc) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-sm text-neutral-500">Loading…</div>
      </div>
    );
  }

  const canFinalize = !doc.isFinalized;
  const canExport = doc.isFinalized;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <FadeInUp className="flex flex-col gap-4 pb-8">
        <Link
          href="/documents"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" />
          All documents
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {editingTitle && !doc.isFinalized ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false);
                  // Title update not yet supported by documents.save.
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setTitle(doc.title);
                    setEditingTitle(false);
                  }
                }}
                className="min-w-0 flex-1 border-b border-neutral-300 bg-transparent pb-1 font-serif text-3xl tracking-tight text-neutral-900 outline-none focus:border-neutral-900"
              />
            ) : (
              <h1
                className="truncate font-serif text-3xl tracking-tight text-neutral-900 hover:cursor-text"
                onClick={() => {
                  if (!doc.isFinalized) setEditingTitle(true);
                }}
              >
                {title || "Untitled"}
              </h1>
            )}
            {doc.isFinalized ? (
              <Badge variant="success">Finalized</Badge>
            ) : null}
          </div>
        </div>
      </FadeInUp>

      <div className="grid grid-cols-1 gap-6">
        <FadeIn>
          <TiptapEditor
            initialHtml={initialHtml}
            onChange={handleChange}
            extraction={{ docId: doc.id, schemaType: doc.documentType }}
          />
        </FadeIn>

        <FadeIn>
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Button
                  disabled={!canFinalize || finalize.isPending}
                  onClick={() => {
                    setFinalizeError(null);
                    finalize.mutate({ id: doc.id });
                  }}
                >
                  {finalize.isPending
                    ? "Finalizing…"
                    : doc.isFinalized
                      ? "Finalized"
                      : "Finalize"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!canExport || exportPdf.isPending}
                  onClick={() => exportPdf.mutate({ id: doc.id })}
                >
                  {exportPdf.isPending ? "Exporting…" : "Export PDF"}
                </Button>
              </div>
              {finalizeError && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
                    Cannot finalize · {finalizeError.issues?.length ?? 0} issue
                    {(finalizeError.issues?.length ?? 0) === 1 ? "" : "s"}
                  </p>
                  {finalizeError.issues && finalizeError.issues.length > 0 ? (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {finalizeError.issues.slice(0, 8).map((iss, i) => (
                        <li key={i} className="leading-tight">
                          <span className="font-mono text-[10px] text-neutral-500">
                            {iss.path.join(".") || "(root)"}
                          </span>
                          <br />
                          <span className="text-neutral-800 dark:text-neutral-200">
                            {iss.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">
                      {finalizeError.message}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// jsonToInitialHtml — render previously saved validatedJson back into the
// editor as paragraphs, so reopening a document shows your work. The full
// round-trip (Tiptap JSON ⇄ Tiptap JSON) is wired separately when the
// migration off the legacy editor is complete.
// ---------------------------------------------------------------------------

function jsonToInitialHtml(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const out: string[] = [];
  walk(input as Record<string, unknown>, "", (path, value) => {
    out.push(
      `<p><strong>${escapeHtml(path)}:</strong> ${escapeHtml(String(value))}</p>`,
    );
  });
  return out.join("");
}

function walk(
  obj: Record<string, unknown>,
  prefix: string,
  emit: (path: string, value: string | number | boolean) => void,
): void {
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_meta" || k === "__ease__" || k === "display_order") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      emit(path, v);
      continue;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          walk(item as Record<string, unknown>, `${path}.${i}`, emit);
        } else if (item !== null && item !== undefined) {
          emit(`${path}.${i}`, item as string | number | boolean);
        }
      });
      continue;
    }
    if (typeof v === "object") {
      walk(v as Record<string, unknown>, path, emit);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// extractIssues — pull the path+message issue list out of the tRPC zodError
// blob without taking a hard runtime dep on Zod's internal shape.
// ---------------------------------------------------------------------------

function extractIssues(
  zodError: unknown,
): readonly { path: readonly (string | number)[]; message: string }[] | undefined {
  if (!zodError || typeof zodError !== "object") return undefined;
  const issues = (zodError as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return undefined;
  const out: { path: readonly (string | number)[]; message: string }[] = [];
  for (const it of issues) {
    if (!it || typeof it !== "object") continue;
    const path = (it as { path?: unknown }).path;
    const message = (it as { message?: unknown }).message;
    if (Array.isArray(path) && typeof message === "string") {
      out.push({
        path: path.filter(
          (p): p is string | number => typeof p === "string" || typeof p === "number",
        ),
        message,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}
