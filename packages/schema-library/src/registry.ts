import { z, type ZodType } from 'zod';

import { ContractSchema } from './contract.js';
import { InvoiceSchema } from './invoice.js';
import { ResumeSchema } from './resume.js';

export const DocumentSchema = z.discriminatedUnion('document_type', [
  ContractSchema,
  ResumeSchema,
  InvoiceSchema,
]);

export type GlyphDocument = z.infer<typeof DocumentSchema>;

export type DocumentType = 'contract' | 'resume' | 'invoice';

const BUILT_IN_KEYS: ReadonlySet<string> = new Set(['contract', 'resume', 'invoice']);

/** Returns true if the given string is one of the three built-in document types. */
export function isBuiltInDocumentType(type: string): type is DocumentType {
  return BUILT_IN_KEYS.has(type);
}

const REGISTRY = {
  contract: ContractSchema,
  resume: ResumeSchema,
  invoice: InvoiceSchema,
} as const satisfies Record<DocumentType, ZodType>;

/**
 * Return the Zod schema for a given document type.
 *
 * Throws if called with an unregistered type. Callers that accept user
 * input should validate the type before calling.
 */
export function getSchema(type: DocumentType): ZodType {
  const schema = REGISTRY[type];
  if (schema === undefined) {
    throw new Error(`Unknown document type: ${String(type)}`);
  }
  return schema;
}
