"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { FadeInUp } from "@/components/motion/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export default function TypeDetailPage({
  params,
}: {
  params: Promise<{ typeKey: string }>;
}) {
  const { typeKey } = use(params);
  const router = useRouter();
  const type = trpc.documentTypes.getTypeByKey.useQuery({ key: typeKey });
  const templates = trpc.documentTypes.listTemplatesForType.useQuery(
    { typeId: type.data?.id ?? "" },
    { enabled: type.data !== undefined },
  );
  const [cloning, setCloning] = useState<string | null>(null);

  const cloneMutation = trpc.documentTypes.upsertTemplate.useMutation({
    onSuccess: (data) => {
      setCloning(null);
      router.push(`/settings/document-types/${typeKey}/templates/${data.id}`);
    },
    onError: () => setCloning(null),
  });

  const clone = (templateId: string, srcName: string, descriptors: unknown, typeId: string) => {
    if (!Array.isArray(descriptors)) return;
    setCloning(templateId);
    cloneMutation.mutate({
      documentTypeId: typeId,
      name: `${srcName} (Copy)`,
      descriptors: descriptors as Array<{
        path: string;
        label: string;
        section: string;
      }>,
    });
  };

  if (type.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (!type.data) return <p className="text-sm text-neutral-500">Not found.</p>;

  return (
    <FadeInUp>
      <div className="mb-2">
        <Link
          href="/settings/document-types"
          className="text-xs uppercase tracking-[0.18em] text-neutral-500 hover:text-neutral-900"
        >
          ← All types
        </Link>
      </div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl tracking-tight text-neutral-900">
              {type.data.name}
            </h1>
            {type.data.isSystem ? (
              <Badge variant="accent">System</Badge>
            ) : (
              <Badge variant="outline">Custom</Badge>
            )}
          </div>
          {type.data.description && (
            <p className="mt-1 text-sm text-neutral-500">{type.data.description}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-neutral-400">
            <span className="font-mono">{type.data.key}</span>
            <span>·</span>
            <span>v{type.data.schemaVersion}</span>
            <span>·</span>
            <span>Renderer: {type.data.rendererId}</span>
          </div>
        </div>
      </div>

      <h2 className="mb-3 text-sm font-medium text-neutral-700">Templates</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(templates.data ?? []).map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{t.name}</CardTitle>
                {t.isSystem ? (
                  <Badge variant="accent">System</Badge>
                ) : (
                  <Badge variant="secondary">Mine</Badge>
                )}
              </div>
              {t.description && <CardDescription>{t.description}</CardDescription>}
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/settings/document-types/${typeKey}/templates/${t.id}`}>
                  {t.isMine ? "Edit" : "View"}
                </Link>
              </Button>
              {t.isSystem && type.data && (
                <Button
                  size="sm"
                  onClick={() =>
                    clone(t.id, t.name, t.descriptors, type.data!.id)
                  }
                  disabled={cloning === t.id}
                >
                  {cloning === t.id ? "Cloning…" : "Clone"}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {templates.data !== undefined && templates.data.length === 0 && (
          <p className="text-sm text-neutral-500">No templates yet.</p>
        )}
      </div>
    </FadeInUp>
  );
}
