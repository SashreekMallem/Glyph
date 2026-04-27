"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CreateDocDialog } from "@/components/documents/CreateDocDialog";
import { DeleteDocDialog } from "@/components/documents/DeleteDocDialog";
import { DocumentCard } from "@/components/documents/DocumentCard";
import {
  FadeIn,
  FadeInUp,
  Stagger,
  StaggerChild,
} from "@/components/motion/primitives";

interface PendingDelete {
  readonly id: string;
  readonly title: string;
}

export default function DocumentsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const list = trpc.documents.list.useQuery();
  const docs = list.data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <FadeInUp className="flex flex-col gap-2 pb-10 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-3xl tracking-tight text-neutral-900">
            Documents
          </h1>
          <p className="text-sm text-neutral-500">
            Draft, validate, and finalize structured documents.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New document</Button>
      </FadeInUp>

      {list.isLoading ? (
        <FadeIn className="py-10 text-sm text-neutral-500">Loading…</FadeIn>
      ) : docs.length === 0 ? (
        <FadeIn>
          <Card className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-12 text-center">
            <h2 className="font-serif text-xl tracking-tight text-neutral-900">
              No documents yet
            </h2>
            <p className="text-sm text-neutral-500">
              Start a new document to capture structured content backed by a
              schema.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              Create your first document
            </Button>
          </Card>
        </FadeIn>
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <StaggerChild key={d.id}>
              <DocumentCard
                doc={d}
                onDelete={(doc) =>
                  setPendingDelete({ id: doc.id, title: doc.title })
                }
              />
            </StaggerChild>
          ))}
        </Stagger>
      )}

      <CreateDocDialog open={createOpen} onOpenChange={setCreateOpen} />
      {pendingDelete !== null ? (
        <DeleteDocDialog
          open={true}
          onOpenChange={(v) => {
            if (!v) setPendingDelete(null);
          }}
          docId={pendingDelete.id}
          docTitle={pendingDelete.title}
          onDeleted={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
