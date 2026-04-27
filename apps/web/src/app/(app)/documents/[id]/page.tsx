"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { Editor } from "@/components/editor/Editor";
import type { DocType } from "@/components/editor/descriptors";
import type { ValidationReport } from "@/components/editor/plugins/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn, FadeInUp } from "@/components/motion/primitives";

function isDocType(v: string): v is DocType {
  return v === "contract" || v === "resume" || v === "invoice";
}

export default function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const docQuery = trpc.documents.get.useQuery({ id });
  const doc = docQuery.data;

  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);

  useEffect(() => {
    if (doc) setTitle(doc.title);
  }, [doc]);

  const save = trpc.documents.save.useMutation({
    onSuccess: () => {
      void utils.documents.list.invalidate();
    },
  });
  const finalize = trpc.documents.finalize.useMutation({
    onSuccess: async () => {
      await utils.documents.get.invalidate({ id });
      await utils.documents.list.invalidate();
    },
  });
  const exportPdf = trpc.documents.exportPdf.useMutation({
    onSuccess: (data) => {
      if (typeof window !== "undefined") {
        window.open(data.url, "_blank");
      }
    },
  });

  const handleSave = useCallback(
    (json: Record<string, unknown>) => {
      if (!doc) return;
      save.mutate({
        id: doc.id,
        prosemirrorState: doc.prosemirrorState,
        validatedJson: json,
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

  const docType = doc.documentType;
  const typeSupported = isDocType(docType);

  const canFinalize =
    !doc.isFinalized && validation !== null && validation.valid;
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <FadeIn className="lg:col-span-2">
          <Card className="p-6">
            {typeSupported ? (
              <Editor
                documentType={docType}
                onSave={handleSave}
                onValidation={setValidation}
              />
            ) : (
              <div className="text-sm text-neutral-500">
                Editor does not yet support the
                <span className="font-medium"> {docType}</span> document type.
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Validation</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {validation === null ? (
                <div className="text-sm text-neutral-500">
                  Waiting for input…
                </div>
              ) : validation.valid ? (
                <Badge variant="success" className="w-fit">
                  Valid
                </Badge>
              ) : "drafting" in validation && validation.drafting ? (
                <div className="text-sm text-neutral-500">
                  Drafting… keep typing. The classifier will tag fields
                  automatically.
                </div>
              ) : "errors" in validation ? (
                <div className="flex flex-col gap-2">
                  <Badge variant="destructive" className="w-fit">
                    {validation.errors.length} issue
                    {validation.errors.length === 1 ? "" : "s"}
                  </Badge>
                  <ul className="space-y-1.5 text-sm">
                    {validation.errors.map((e, i) => (
                      <li key={i} className="leading-tight">
                        <span className="font-mono text-xs text-neutral-400">
                          {e.path || "(root)"}
                        </span>
                        <br />
                        <span className="text-neutral-700">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4">
                <Button
                  disabled={!canFinalize || finalize.isPending}
                  onClick={() => finalize.mutate({ id: doc.id })}
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
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
