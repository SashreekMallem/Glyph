"use client";

import { use, useCallback, useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { TiptapEditor } from "@/components/editor/TiptapEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FadeIn, FadeInUp } from "@/components/motion/primitives";
import { ChevronDown, FileText, Code2, Type, Download } from "lucide-react";

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
  // Extracted JSON from Gemini — kept separate from the editor document.
  const [extractedJson, setExtractedJson] = useState<Record<string, unknown> | null>(null);

  // The Tiptap editor content is stored in prosemirrorState (encrypted).
  // Cast it to object so Tiptap can hydrate directly — no HTML conversion.
  const initialContent = doc?.prosemirrorState as object | undefined;

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

  const latestDocState = useRef<unknown>(doc?.prosemirrorState);

  // Save the Tiptap document JSON to prosemirrorState.
  const handleChange = useCallback(
    (json: object) => {
      latestDocState.current = json;
      if (!doc) return;
      save.mutate({
        id: doc.id,
        prosemirrorState: json,
        validatedJson: extractedJson ?? (doc.validatedJson as Record<string, unknown> | null),
      });
    },
    [doc, save, extractedJson],
  );

  // When extraction produces new structured JSON, persist it.
  const handleExtracted = useCallback(
    (json: Record<string, unknown>) => {
      setExtractedJson(json);
      if (!doc) return;
      save.mutate({
        id: doc.id,
        prosemirrorState: latestDocState.current ?? doc.prosemirrorState,
        validatedJson: json,
      });
    },
    [doc, save],
  );

  // Memoize extraction prop to avoid infinite loop in TiptapEditor useEffect
  const extractionProp = useMemo(() => {
    if (!doc) return undefined;
    return { 
      docId: doc.id, 
      schemaType: doc.documentType,
      initialJson: extractedJson ?? doc.validatedJson ?? undefined,
      encrypted: doc.encryptedPayload ?? undefined,
      iv: doc.payloadIv ?? undefined,
      tag: doc.payloadTag ?? undefined,
      signature: doc.payloadSignature ?? undefined,
    };
  }, [doc?.id, doc?.documentType, doc?.validatedJson, extractedJson, doc?.encryptedPayload, doc?.payloadIv, doc?.payloadTag, doc?.payloadSignature]);

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
    <div className="flex flex-col min-h-screen bg-neutral-50/50 dark:bg-neutral-950/50">
      {/* Sticky Header with Title and Actions */}
      <header className="sticky top-0 z-30 w-full border-b border-neutral-200 bg-white/80 backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-6">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <Link
              href="/documents"
              className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            
            <div className="flex items-center gap-3 min-w-0">
              {editingTitle && !doc.isFinalized ? (
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") {
                      setTitle(doc.title);
                      setEditingTitle(false);
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent font-serif text-xl font-medium tracking-tight text-neutral-900 outline-none dark:text-neutral-100"
                />
              ) : (
                <h1
                  className="truncate font-serif text-xl font-medium tracking-tight text-neutral-900 hover:cursor-text dark:text-neutral-100"
                  onClick={() => {
                    if (!doc.isFinalized) setEditingTitle(true);
                  }}
                >
                  {title || "Untitled Document"}
                </h1>
              )}
              {doc.isFinalized && (
                <Badge variant="success" className="h-5 px-1.5 text-[10px] uppercase tracking-wider">
                  Finalized
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!doc.isFinalized && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 text-xs font-semibold uppercase tracking-wider"
                disabled={!canFinalize || finalize.isPending}
                onClick={() => {
                  setFinalizeError(null);
                  finalize.mutate({ id: doc.id });
                }}
              >
                {finalize.isPending ? "Finalizing…" : "Finalize"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-9 px-4 text-xs font-semibold uppercase tracking-wider gap-2"
                  disabled={!canExport || exportPdf.isPending}
                >
                  {exportPdf.isPending ? "Exporting…" : "Export"}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => exportPdf.mutate({ id: doc.id })} className="gap-2">
                  <Download className="h-4 w-4" />
                  <span>Export PDF</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => {
                    document.dispatchEvent(new CustomEvent("glyph-export-docx"));
                  }} 
                  className="gap-2"
                >
                  <FileText className="h-4 w-4" />
                  <span>Export Word (.doc)</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => document.dispatchEvent(new CustomEvent("glyph-export-md"))} 
                  className="gap-2"
                >
                  <Code2 className="h-4 w-4" />
                  <span>Export Markdown (.md)</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => document.dispatchEvent(new CustomEvent("glyph-export-txt"))} 
                  className="gap-2"
                >
                  <Type className="h-4 w-4" />
                  <span>Export Text (.txt)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-8">
        <div className="grid grid-cols-1 gap-8">
          {finalizeError && (
            <FadeIn>
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
                <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider">
                    Validation Failed — {finalizeError.issues?.length ?? 0} Issues
                  </span>
                </div>
                {finalizeError.issues && finalizeError.issues.length > 0 && (
                  <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {finalizeError.issues.slice(0, 9).map((iss, i) => (
                      <li key={i} className="rounded-lg border border-rose-100 bg-white p-2.5 shadow-sm dark:border-rose-900/30 dark:bg-neutral-900">
                        <div className="font-mono text-[9px] uppercase text-neutral-400">
                          {iss.path.join(".") || "(root)"}
                        </div>
                        <div className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
                          {iss.message}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </FadeIn>
          )}

          <FadeIn className="min-w-0">
            <TiptapEditor
              initialContent={initialContent}
              readOnly={doc.isFinalized}
              onChange={handleChange}
              onExtracted={handleExtracted}
              extraction={extractionProp}
              styleProfile={doc.styleProfile}
              documentId={doc.id}
            />
          </FadeIn>
        </div>
      </main>
    </div>
  );
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
