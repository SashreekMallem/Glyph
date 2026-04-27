/**
 * Public-facing DTOs for documents and API keys.
 *
 * Keep plaintext `validatedJson` and the master-key-encrypted payload
 * columns out of these — they are server-only. The sole public path to
 * plaintext is `POST /api/v1/extract` via a valid API key.
 */

import type { ApiKey, Document } from "@/db/schema";

export interface DocumentDTO {
  id: string;
  userId: string;
  title: string;
  documentType: Document["documentType"];
  schemaVersion: string;
  prosemirrorState: unknown;
  isFinalized: boolean;
  createdAt: string;
  updatedAt: string;
  /** Only present when the caller owns the document and it is not yet finalized. */
  validatedJson?: unknown;
}

export function toDocumentDTO(
  doc: Document,
  opts: { includeValidatedJson?: boolean } = {},
): DocumentDTO {
  const dto: DocumentDTO = {
    id: doc.id,
    userId: doc.userId,
    title: doc.title,
    documentType: doc.documentType,
    schemaVersion: doc.schemaVersion,
    prosemirrorState: doc.prosemirrorState,
    isFinalized: doc.isFinalized,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
  if (opts.includeValidatedJson && !doc.isFinalized) {
    dto.validatedJson = doc.validatedJson;
  }
  return dto;
}

export interface ApiKeyDTO {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  requestCount: number;
  isActive: boolean;
  createdAt: string;
}

export function toApiKeyDTO(key: ApiKey): ApiKeyDTO {
  return {
    id: key.id,
    name: key.name,
    prefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    requestCount: key.requestCount,
    isActive: key.isActive,
    createdAt: key.createdAt.toISOString(),
  };
}
