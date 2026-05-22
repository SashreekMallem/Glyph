// No built-in document types — schemas live in the document_types table.
// This module re-exports the runtime JSON Schema → Zod converter for
// callers that need to compile a fetched JSON Schema on the fly.

import type { ZodTypeAny } from 'zod';

/** Doc type keys are arbitrary strings — anything in document_types.key works. */
export type DocumentType = string;

/** Always returns false — there are no built-ins anymore. Kept as a function
 *  for compatibility with the small number of call sites that still ask. */
export function isBuiltInDocumentType(_type: string): boolean {
  return false;
}

/** Schemas are resolved at runtime from the DB. This stub exists only to
 *  satisfy legacy MCP code that hasn't been migrated yet; it throws. */
export function getSchema(_type: string): ZodTypeAny {
  throw new Error(
    'getSchema(typeKey) is no longer supported. Use resolveSchema(db, { typeKey }) ' +
      'from apps/web/src/lib/extract/resolve-schema.ts instead.',
  );
}
