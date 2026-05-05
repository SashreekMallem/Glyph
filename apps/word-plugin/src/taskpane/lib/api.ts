import type { DocumentType } from '@glyph/schema-library';

export interface ZodIssueLite {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  readonly code?: string;
}

export interface ValidateResponse {
  readonly extracted: unknown;
  readonly errors: ReadonlyArray<ZodIssueLite>;
  readonly valid: boolean;
}

export interface FinalizeResponse {
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
  readonly signature: string;
  readonly schemaVersion: string;
  readonly documentType: DocumentType;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function getBaseUrl(): string {
  // `import.meta.env` is populated by Vite at build time.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const override = env?.VITE_GLYPH_API_URL;
  if (override !== undefined && override.length > 0) return override.replace(/\/$/, '');
  return 'https://glyph.dev';
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') ?? '';
  const parsed: unknown = contentType.includes('application/json')
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const msg =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error?: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, parsed);
  }
  return parsed as T;
}

export async function validate(input: {
  readonly documentType: DocumentType;
  readonly text: string;
}): Promise<ValidateResponse> {
  return postJson<ValidateResponse>('/api/word/validate', input);
}

export async function finalize(input: {
  readonly documentType: DocumentType;
  readonly text: string;
  /**
   * Optional per-leaf source regions (dot-notation path → `[start, end)`
   * offsets into `text`). When supplied, the server signs them into the
   * payload so subsequent reads can detect drift field-by-field. Without
   * regions, drift detection still works after first sync — the first
   * call will trigger a one-time full re-extract.
   */
  readonly regions?: Record<string, [number, number]>;
}): Promise<FinalizeResponse> {
  return postJson<FinalizeResponse>('/api/word/finalize', input);
}

export interface SyncResponse {
  readonly status: 'in_sync' | 'synced' | 'no_payload';
  readonly data: unknown;
  readonly document_type: string | null;
  readonly schema_version: string | null;
  readonly signature_valid: boolean;
  readonly drift: {
    readonly changed: readonly string[];
    readonly added: readonly string[];
    readonly removed: readonly string[];
  } | null;
  /** Embedded XML fragment (.docx Custom XML Part body). */
  readonly embedded_xml: string | null;
  readonly updated_file_b64: string | null;
  readonly format: 'docx' | 'pdf';
}

/**
 * Send the current .docx bytes to the unified self-healing-sync endpoint.
 * On `synced`, callers should write `embedded_xml` back into the document
 * via {@link replaceGlyphCustomXmlPart}.
 */
export async function syncDocument(
  fileBytes: Uint8Array,
  apiKey: string,
): Promise<SyncResponse> {
  const url = `${getBaseUrl()}/api/v1/sync`;
  // Cast through ArrayBuffer to satisfy TS's strict BlobPart typing under
  // SharedArrayBuffer-aware lib.dom (Uint8Array<ArrayBufferLike> isn't
  // structurally assignable to BlobPart). The runtime cost is zero — the
  // underlying buffer is shared by reference.
  const blob = new Blob([fileBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const form = new FormData();
  form.append('file', blob, 'document.docx');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const parsed: unknown = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const msg =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error?: unknown }).error)
        : `sync failed (${res.status})`;
    throw new ApiError(res.status, msg, parsed);
  }
  return parsed as SyncResponse;
}
