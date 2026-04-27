"use client";

import Link from "next/link";
import { use } from "react";
import { FadeInUp } from "@/components/motion/primitives";
import {
  TemplateEditor,
  type FieldDescriptor,
} from "@/components/document-types/TemplateEditor";
import { trpc } from "@/lib/trpc";

export default function TemplatePage({
  params,
}: {
  params: Promise<{ typeKey: string; templateId: string }>;
}) {
  const { typeKey, templateId } = use(params);
  const template = trpc.documentTypes.getTemplate.useQuery({ id: templateId });

  if (template.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (!template.data) return <p className="text-sm text-neutral-500">Not found.</p>;

  const descriptors = Array.isArray(template.data.descriptors)
    ? (template.data.descriptors as FieldDescriptor[])
    : [];

  return (
    <FadeInUp>
      <div className="mb-2">
        <Link
          href={`/settings/document-types/${typeKey}`}
          className="text-xs uppercase tracking-[0.18em] text-neutral-500 hover:text-neutral-900"
        >
          ← Back to type
        </Link>
      </div>
      <h1 className="mb-6 font-serif text-2xl tracking-tight text-neutral-900">
        {template.data.name}
      </h1>
      <TemplateEditor
        template={{
          id: template.data.id,
          documentTypeId: template.data.documentTypeId,
          name: template.data.name,
          description: template.data.description,
          descriptors,
          isSystem: template.data.isSystem,
        }}
        typeKey={typeKey}
      />
    </FadeInUp>
  );
}
