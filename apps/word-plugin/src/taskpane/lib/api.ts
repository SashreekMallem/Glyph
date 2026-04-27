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
}): Promise<FinalizeResponse> {
  return postJson<FinalizeResponse>('/api/word/finalize', input);
}
