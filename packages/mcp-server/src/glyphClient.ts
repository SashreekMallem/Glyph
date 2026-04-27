/**
 * Thin HTTP client to the Glyph web API.
 *
 * Used by the `generate_structured_document` tool to request a finalized
 * document from /api/mcp/generate. Keeps fetch/mocking surface narrow.
 */

export interface GenerateRequest {
  readonly documentType: 'contract' | 'resume' | 'invoice';
  readonly structuredData: Record<string, unknown>;
  readonly outputFormat: 'pdf' | 'docx';
  readonly title: string;
}

export interface GenerateSuccess {
  readonly ok: true;
  readonly downloadUrl: string;
  readonly expiresIn: number;
}
export interface GenerateFailure {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message: string;
}
export type GenerateResult = GenerateSuccess | GenerateFailure;

export interface GlyphClientOptions {
  readonly baseUrl: string;
  /** Injected for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class GlyphClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GlyphClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate(apiKey: string, body: GenerateRequest): Promise<GenerateResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/mcp/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const obj =
        json !== null && typeof json === 'object'
          ? (json as Record<string, unknown>)
          : {};
      const errObj =
        obj.error !== undefined && obj.error !== null && typeof obj.error === 'object'
          ? (obj.error as Record<string, unknown>)
          : obj;
      const code = typeof errObj.code === 'string' ? errObj.code : 'http_error';
      const message =
        typeof errObj.message === 'string'
          ? errObj.message
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, code, message };
    }
    if (json === null || typeof json !== 'object') {
      return {
        ok: false,
        status: 502,
        code: 'bad_upstream_response',
        message: 'Glyph API returned non-JSON body.',
      };
    }
    const obj = json as Record<string, unknown>;
    const downloadUrl = obj.downloadUrl;
    const expiresIn = obj.expiresIn;
    if (typeof downloadUrl !== 'string' || typeof expiresIn !== 'number') {
      return {
        ok: false,
        status: 502,
        code: 'bad_upstream_response',
        message: 'Glyph API response missing downloadUrl/expiresIn.',
      };
    }
    return { ok: true, downloadUrl, expiresIn };
  }
}
