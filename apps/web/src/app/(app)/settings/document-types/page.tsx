"use client";

import Link from "next/link";
import { FadeInUp, Stagger, StaggerChild } from "@/components/motion/primitives";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export default function DocumentTypesPage() {
  const types = trpc.documentTypes.listTypes.useQuery();

  return (
    <FadeInUp>
      <div className="mb-6">
        <h1 className="font-serif text-2xl tracking-tight text-neutral-900">
          Document Types
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Schemas and field templates that every Glyph document is authored against.
          Clone a system template to customize labels and sections.
        </p>
      </div>

      {types.isLoading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(types.data ?? []).map((t) => (
            <StaggerChild key={t.id}>
              <Link href={`/settings/document-types/${t.key}`}>
                <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>{t.name}</CardTitle>
                      {t.isSystem ? (
                        <Badge variant="accent">System</Badge>
                      ) : (
                        <Badge variant="outline">Custom</Badge>
                      )}
                    </div>
                    <CardDescription className="line-clamp-2">
                      {t.description ?? "—"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-3 text-xs text-neutral-500">
                      <span className="font-mono">{t.key}</span>
                      <span>·</span>
                      <span>v{t.schemaVersion}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </StaggerChild>
          ))}
        </Stagger>
      )}
    </FadeInUp>
  );
}
