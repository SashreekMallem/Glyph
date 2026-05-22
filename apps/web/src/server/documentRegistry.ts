/**
 * Server-side document type + template registry.
 *
 * Bridges the DB-backed `document_types` / `document_templates` tables
 * to the rest of the app. Every schema — including the legacy
 * `contract`/`resume`/`invoice` keys — lives in the `document_types`
 * table now. We compile the stored JSON Schema to Zod at runtime.
 *
 * All functions here return cache-friendly data — callers may memoise
 * for the duration of a request.
 */

import { eq, sql as dsql } from "drizzle-orm";
import type { ZodTypeAny } from "zod";
import {
  isBuiltInDocumentType,
  jsonSchemaToZod,
} from "@glyph/schema-library";

import { db } from "@/db";
import {
  documentTemplates,
  documentTypes,
  schemaBlocks,
  type DocumentTemplate,
  type DocumentTypeRow,
} from "@/db/schema";
import {
  defaultCompositionForDomain,
  resolveComposition,
} from "@/server/composition";

export interface FieldDescriptor {
  readonly path: string;
  readonly label: string;
  readonly section: string;
  readonly type?: "string" | "number" | "boolean" | "date";
  readonly placeholder?: string;
}

/**
 * Re-export the canonical built-in check from `@glyph/schema-library` so
 * server code has one place to import from. Avoid duplicating the set.
 */
export const isBuiltInType = isBuiltInDocumentType;

export async function getTypeRow(key: string): Promise<DocumentTypeRow | null> {
  const [row] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.key, key))
    .limit(1);
  return row ?? null;
}

export interface ResolvedSchema {
  readonly zod: ZodTypeAny;
  readonly jsonSchema: Record<string, unknown> | null;
  readonly compositionId: string | null;
  readonly blockIds: readonly string[] | null;
  readonly source: "blocks" | "custom_type";
}

/**
 * Resolves a document schema across all three modes:
 *   1. blocks: caller passes explicit `blockIds` -> resolveComposition.
 *   2. blocks-default: caller passes only `documentType` and that domain
 *      has REQUIRED blocks registered -> defaultCompositionForDomain.
 *   3. custom_type: domain has no blocks but exists in `documentTypes`
 *      (this is where every system type — contract/resume/invoice — and
 *      every user-defined type lives).
 *
 * Throws on unknown document types.
 */
export async function resolveSchema(args: {
  documentType: string;
  blockIds?: readonly string[];
  userId?: string;
}): Promise<ResolvedSchema> {
  const { documentType, blockIds, userId } = args;

  // 1. Explicit block ids.
  if (blockIds && blockIds.length > 0) {
    const composed = await resolveComposition({
      domain: documentType,
      blockIds,
      userId,
    });
    return {
      zod: composed.zod,
      jsonSchema: composed.jsonSchema,
      compositionId: composed.compositionId,
      blockIds: composed.blockIds,
      source: "blocks",
    };
  }

  // 2. Default composition from REQUIRED blocks for the domain.
  const blockCountRows = await db
    .select({ c: dsql<number>`count(*)::int` })
    .from(schemaBlocks)
    .where(eq(schemaBlocks.domain, documentType));
  const blockCount = blockCountRows[0]?.c ?? 0;
  if (blockCount > 0) {
    try {
      const composed = await defaultCompositionForDomain(documentType, userId);
      return {
        zod: composed.zod,
        jsonSchema: composed.jsonSchema,
        compositionId: composed.compositionId,
        blockIds: composed.blockIds,
        source: "blocks",
      };
    } catch {
      // No required blocks — fall through to custom_type lookup.
    }
  }

  // 3. Type stored in `document_types` (system or user-registered).
  const row = await getTypeRow(documentType);
  if (row !== null) {
    const json = row.jsonSchema as Record<string, unknown>;
    return {
      zod: jsonSchemaToZod(json as Parameters<typeof jsonSchemaToZod>[0]),
      jsonSchema: json,
      compositionId: null,
      blockIds: null,
      source: "custom_type",
    };
  }

  throw new Error(`Unknown document type: ${documentType}`);
}

/**
 * Return the Zod validator for a document type by key.
 *
 * Backwards-compatible wrapper around {@link resolveSchema}: it calls
 * the new resolver without `blockIds` so the default composition is used
 * when one exists, otherwise falls back to the custom_type / built-in
 * paths. Existing callers continue to work unchanged.
 */
export async function getValidatorForType(key: string): Promise<ZodTypeAny> {
  const resolved = await resolveSchema({ documentType: key });
  return resolved.zod;
}

/**
 * List all document types available to a given user: system types +
 * any the user has created themselves.
 */
export async function listTypesForUser(userId: string): Promise<DocumentTypeRow[]> {
  const rows = await db.select().from(documentTypes);
  return rows.filter((r) => r.isSystem || r.userId === userId);
}

/**
 * List templates for a document type visible to a user.
 */
export async function listTemplatesForType(
  typeId: string,
  userId: string,
): Promise<DocumentTemplate[]> {
  const rows = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.documentTypeId, typeId));
  return rows.filter((r) => r.isSystem || r.userId === userId);
}

/** Pick the first system template for the given type (used as a default). */
export async function getDefaultTemplateForType(
  typeKey: string,
): Promise<{ type: DocumentTypeRow; template: DocumentTemplate } | null> {
  const type = await getTypeRow(typeKey);
  if (type === null) return null;
  const [template] = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.documentTypeId, type.id))
    .limit(1);
  if (template === undefined) return null;
  return { type, template };
}
