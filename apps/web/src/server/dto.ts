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
  /**
   * Ciphertext + signature for the canonical signed payload. Safe to
   * expose — useless without the server's master/signing keys. Surfaced
   * so the editor page can pass them through to the TiptapEditor for
   * re-hydration on open.
   */
  encryptedPayload?: string | null;
  payloadIv?: string | null;
  payloadTag?: string | null;
  payloadSignature?: string | null;
}

export function toDocumentDTO(
  doc: Document,
  opts: {
    includeValidatedJson?: boolean;
    /**
     * Already-decrypted plaintext for the at-rest-encrypted columns.
     * The router decrypts before calling this so the DTO stays
     * shape-compatible with the client (which expects plaintext to
     * render the editor). When omitted, both fields are `null`/absent.
     */
    prosemirrorState?: unknown;
    validatedJson?: unknown;
  } = {},
): DocumentDTO {
  const dto: DocumentDTO = {
    id: doc.id,
    userId: doc.userId,
    title: doc.title,
    documentType: doc.documentType,
    schemaVersion: doc.schemaVersion,
    prosemirrorState: opts.prosemirrorState ?? null,
    isFinalized: doc.isFinalized,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
  if (opts.includeValidatedJson && !doc.isFinalized) {
    dto.validatedJson = opts.validatedJson ?? null;
  }
  dto.encryptedPayload = doc.encryptedPayload;
  dto.payloadIv = doc.payloadIv;
  dto.payloadTag = doc.payloadTag;
  dto.payloadSignature = doc.payloadSignature;
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
