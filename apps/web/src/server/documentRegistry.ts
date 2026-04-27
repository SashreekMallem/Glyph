/**
 * Server-side document type + template registry.
 *
 * Bridges the DB-backed `document_types` / `document_templates` tables
 * to the rest of the app. The three built-in types ("contract" |
 * "resume" | "invoice") also have compile-time Zod schemas in
 * `@glyph/schema-library`; for them we prefer the compile-time schema
 * (it's what the PDF renderer and MCP heuristic use). For every other
 * type we compile the stored JSON Schema to Zod at runtime.
 *
 * All functions here return cache-friendly data — callers may memoise
 * for the duration of a request.
 */

import { eq } from "drizzle-orm";
import type { ZodTypeAny } from "zod";
import {
  getSchema as getBuiltInSchema,
  jsonSchemaToZod,
  type DocumentType as BuiltInDocumentType,
} from "@glyph/schema-library";

import { db } from "@/db";
import {
  documentTemplates,
  documentTypes,
  type DocumentTemplate,
  type DocumentTypeRow,
} from "@/db/schema";

export interface FieldDescriptor {
  readonly path: string;
  readonly label: string;
  readonly section: string;
  readonly type?: "string" | "number" | "boolean" | "date";
  readonly placeholder?: string;
}

const BUILT_INS: ReadonlySet<string> = new Set(["contract", "resume", "invoice"]);

export function isBuiltInType(key: string): key is BuiltInDocumentType {
  return BUILT_INS.has(key);
}

export async function getTypeRow(key: string): Promise<DocumentTypeRow | null> {
  const [row] = await db
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * Return the Zod validator for a document type by key. For built-ins
 * this is the compile-time schema; for custom types it is derived from
 * `documentTypes.jsonSchema`.
 *
 * Throws if no row exists and the key isn't a built-in.
 */
export async function getValidatorForType(key: string): Promise<ZodTypeAny> {
  if (isBuiltInType(key)) {
    return getBuiltInSchema(key) as ZodTypeAny;
  }
  const row = await getTypeRow(key);
  if (row === null) {
    throw new Error(`Unknown document type: ${key}`);
  }
  return jsonSchemaToZod(row.jsonSchema as Parameters<typeof jsonSchemaToZod>[0]);
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
