/**
 * Seed the three built-in document types + their default system
 * templates.
 *
 * Run once after the 0001_document_registry migration. Idempotent —
 * uses upsert-style logic keyed on `documentTypes.key` and composite
 * (documentTypeId, name) for templates.
 */

import { eq, and } from "drizzle-orm";
import { ContractSchema, InvoiceSchema, ResumeSchema, toJsonSchema } from "@glyph/schema-library";

import { db } from "@/db";
import { documentTemplates, documentTypes } from "@/db/schema";

import {
  CONTRACT_TEMPLATE,
  INVOICE_TEMPLATE,
  RESUME_TEMPLATE,
} from "./default-templates";

interface Seed {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly rendererId: string;
  readonly jsonSchema: unknown;
  readonly templateName: string;
  readonly descriptors: unknown;
}

const SEEDS: readonly Seed[] = [
  {
    key: "contract",
    name: "Contract",
    description: "Binding agreement between two or more parties.",
    rendererId: "contract",
    jsonSchema: toJsonSchema(ContractSchema),
    templateName: "Standard Contract",
    descriptors: CONTRACT_TEMPLATE,
  },
  {
    key: "resume",
    name: "Resume",
    description: "Professional work history and credentials.",
    rendererId: "resume",
    jsonSchema: toJsonSchema(ResumeSchema),
    templateName: "Standard Resume",
    descriptors: RESUME_TEMPLATE,
  },
  {
    key: "invoice",
    name: "Invoice",
    description: "Itemised bill for goods or services.",
    rendererId: "invoice",
    jsonSchema: toJsonSchema(InvoiceSchema),
    templateName: "Standard Invoice",
    descriptors: INVOICE_TEMPLATE,
  },
];

export async function seedDocumentRegistry(): Promise<void> {
  for (const seed of SEEDS) {
    const existingType = await db
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.key, seed.key))
      .limit(1);

    let typeId: string;
    if (existingType[0]) {
      typeId = existingType[0].id;
      await db
        .update(documentTypes)
        .set({
          name: seed.name,
          description: seed.description,
          jsonSchema: seed.jsonSchema as Record<string, unknown>,
          rendererId: seed.rendererId,
          isSystem: true,
          updatedAt: new Date(),
        })
        .where(eq(documentTypes.id, typeId));
    } else {
      const [inserted] = await db
        .insert(documentTypes)
        .values({
          key: seed.key,
          name: seed.name,
          description: seed.description,
          jsonSchema: seed.jsonSchema as Record<string, unknown>,
          rendererId: seed.rendererId,
          isSystem: true,
        })
        .returning({ id: documentTypes.id });
      if (!inserted) throw new Error(`Failed to insert type ${seed.key}`);
      typeId = inserted.id;
    }

    const existingTemplate = await db
      .select()
      .from(documentTemplates)
      .where(
        and(
          eq(documentTemplates.documentTypeId, typeId),
          eq(documentTemplates.name, seed.templateName),
          eq(documentTemplates.isSystem, true),
        ),
      )
      .limit(1);

    if (existingTemplate[0]) {
      await db
        .update(documentTemplates)
        .set({
          descriptors: seed.descriptors as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(eq(documentTemplates.id, existingTemplate[0].id));
    } else {
      await db.insert(documentTemplates).values({
        documentTypeId: typeId,
        name: seed.templateName,
        descriptors: seed.descriptors as Record<string, unknown>[],
        isSystem: true,
      });
    }
  }
}

// Allow running via `tsx apps/web/drizzle/seeds/document-registry.ts`.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDocumentRegistry()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("[seed] document registry complete.");
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[seed] failed:", err);
      process.exit(1);
    });
}
