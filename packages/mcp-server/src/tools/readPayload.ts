import { z } from 'zod';
import { unzipSync } from 'fflate';
import {
  decryptPayload,
  fingerprintFields,
  verifySignature,
} from '@glyph/crypto';
import type { ToolResult } from './structure.js';

export const readPayloadTool = {
  name: 'read_glyph_payload',
  description: `Read the structured payload embedded inside a Glyph-stamped .docx or .pdf. Decrypts and verifies the signature locally; calls Glyph's sync endpoint only if drift is detected.

USE THIS WHEN:
- You have a .docx or .pdf and need its structured fields.
- The user uploaded a document and asked "what is in this?" or "extract X from this."
- You need to verify a document's authorship and integrity.

DO NOT USE THIS WHEN:
- You generated the document yourself in this conversation — you already have the data.
- The input is raw text, not a file (use structure_document for that).

WHY: A Glyph document carries its own signed structured payload. Reading it takes ~2 ms with no LLM call and yields the EXACT JSON the author signed. Far cheaper and more accurate than re-OCRing or re-extracting with a model.

DRIFT DETECTION: If the document has been edited outside Glyph since signing, this tool detects the drift via per-field SHA-256 fingerprints and calls Glyph's sync endpoint to refresh only the changed fields. The returned data reflects the current state of the document, not the stale embedded snapshot.

INPUTS:
- format: "docx" | "pdf" | "base64_docx" | "base64_pdf"
- content: base64-encoded file bytes OR an https:// URL to the document

RETURNS:
{
  verified: true | false,        // signature valid?
  status: "in_sync" | "synced" | "no_payload",
  data: { ... structured payload the author signed ... },
  drift: { changed: [...], added: [...], removed: [...] } | null,
  document_type: "resume" | "contract" | ...,
  schema_version: "1.0",
  signed_at: "<ISO timestamp>",
  composition_id: "<uuid>" | null,
  block_ids: [...] | null
}

If status is "no_payload", the file is not a Glyph document — fall back to structure_document for plain extraction.`,
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['docx', 'pdf', 'base64_docx', 'base64_pdf'],
      },
      content: {
        type: 'string',
        description: 'Base64-encoded file bytes OR https:// URL to the document',
      },
    },
    required: ['format', 'content'],
  },
} as const;

const InputSchema = z.object({
  format: z.enum(['docx', 'pdf', 'base64_docx', 'base64_pdf']),
  content: z.string().min(1),
  api_key: z.string().min(1),
});

const GLYPH_NS = 'https://glyph.dev/schemas/v1';

/** Extract a text value from a simple XML element by local name. */
function extractXmlElement(xml: string, localName: string): string | null {
  // Match both namespaced (<ns:Foo> or <glyph:Foo>) and un-namespaced forms.
  // Also handles self-closing tags (which would have no content).
  const patterns = [
    // <AnyPrefix:LocalName>value</AnyPrefix:LocalName>
    new RegExp(`<[^>]*:${localName}[^>]*>([^<]*)<\/[^>]*:${localName}>`, 's'),
    // <LocalName ...>value</LocalName>  (no namespace prefix)
    new RegExp(`<${localName}[^>]*>([^<]*)<\/${localName}>`, 's'),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m && m[1] !== undefined && m[1].trim().length > 0) {
      return m[1].trim();
    }
  }
  return null;
}

interface GlyphFields {
  encrypted: string;
  iv: string;
  tag: string;
  signature: string;
  document_type?: string;
  schema_version?: string;
  signed_at?: string;
  composition_id?: string;
  block_ids?: string[];
}

/** Parse Glyph fields out of an XML string (customXml or XMP). */
function parseGlyphXml(xml: string): GlyphFields | null {
  // Verify the namespace is present somewhere in the document.
  if (!xml.includes(GLYPH_NS) && !xml.includes('EncryptedPayload')) {
    return null;
  }

  const encrypted = extractXmlElement(xml, 'EncryptedPayload');
  const iv = extractXmlElement(xml, 'IV');
  const tag = extractXmlElement(xml, 'Tag');
  const signature = extractXmlElement(xml, 'Signature');

  if (!encrypted || !iv || !tag || !signature) {
    return null;
  }

  const blockIdsRaw = extractXmlElement(xml, 'BlockIds');
  const blockIds = blockIdsRaw
    ? blockIdsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  return {
    encrypted,
    iv,
    tag,
    signature,
    document_type: extractXmlElement(xml, 'DocumentType') ?? undefined,
    schema_version: extractXmlElement(xml, 'SchemaVersion') ?? undefined,
    signed_at: extractXmlElement(xml, 'SignedAt') ?? undefined,
    composition_id: extractXmlElement(xml, 'CompositionId') ?? undefined,
    block_ids: blockIds,
  };
}

/** Resolve content bytes: fetch URL or decode base64. */
async function resolveBytes(
  content: string,
  fetcher: typeof fetch,
): Promise<Buffer> {
  if (content.startsWith('https://')) {
    const res = await fetcher(content);
    if (!res.ok) {
      throw new Error(`Failed to fetch document: HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  return Buffer.from(content, 'base64');
}

/** Extract Glyph fields from a .docx (ZIP) file buffer. */
function extractFromDocx(buf: Buffer): GlyphFields | null {
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new Error('Could not unzip docx — file may be corrupt or not a valid .docx');
  }

  for (const [path, data] of Object.entries(files)) {
    // Look for customXml/item*.xml entries
    if (/^customXml\/item\d*\.xml$/i.test(path)) {
      const xml = Buffer.from(data).toString('utf-8');
      const fields = parseGlyphXml(xml);
      if (fields) return fields;
    }
  }

  // Fallback: scan all XML files in the ZIP for the Glyph namespace
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith('.xml') || path.endsWith('.rels')) {
      const xml = Buffer.from(data).toString('utf-8');
      if (xml.includes(GLYPH_NS) || xml.includes('EncryptedPayload')) {
        const fields = parseGlyphXml(xml);
        if (fields) return fields;
      }
    }
  }

  return null;
}

/** Extract Glyph fields from a PDF file buffer by scanning raw bytes for XMP. */
function extractFromPdf(buf: Buffer): GlyphFields | null {
  const text = buf.toString('latin1'); // latin1 preserves byte values intact

  const xmpStart = text.indexOf('<x:xmpmeta');
  const xmpEnd = text.indexOf('</x:xmpmeta>');

  if (xmpStart === -1 || xmpEnd === -1) {
    return null;
  }

  const xmp = text.slice(xmpStart, xmpEnd + '</x:xmpmeta>'.length);

  // Check the Glyph namespace is present
  if (!xmp.includes(GLYPH_NS) && !xmp.includes('EncryptedPayload')) {
    return null;
  }

  return parseGlyphXml(xmp);
}

const NO_PAYLOAD_RESULT: ToolResult = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        verified: false,
        error:
          'No Glyph payload found in document. Document may not have been created with Glyph.',
      }),
    },
  ],
};

export interface ReadPayloadDeps {
  readonly fetch?: typeof fetch;
  /** Base URL of the Glyph API. Used to call /api/v1/sync on drift. */
  readonly glyphApiUrl?: string;
}

/** Walk `<w:p>` → `<w:t>` runs to recover the visible body text. */
function extractDocxVisibleText(buf: Buffer): string {
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    return '';
  }
  const docXml = files['word/document.xml'];
  if (!docXml) return '';
  const xml = Buffer.from(docXml).toString('utf-8');
  const paragraphs = xml.split(/<w:p[\s>]/);
  const out: string[] = [];
  for (const p of paragraphs) {
    const runs = p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
    const parts: string[] = [];
    for (const run of runs) parts.push(run[1] ?? '');
    if (parts.length > 0) out.push(parts.join(''));
  }
  return out.join('\n');
}

/** Best-effort PDF text — scans `(...) Tj` ops inside `BT...ET`. */
function extractPdfVisibleText(buf: Buffer): string {
  const text = buf.toString('latin1');
  const out: string[] = [];
  const blockRe = /BT([\s\S]*?)ET/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const block = m[1] ?? '';
    const tjRe = /\(((?:[^()\\]|\\[\s\S])*)\)\s*Tj/g;
    let tj: RegExpExecArray | null;
    while ((tj = tjRe.exec(block)) !== null) {
      out.push((tj[1] ?? '').replace(/\\([\\()])/g, '$1'));
    }
    out.push('\n');
  }
  return out.join('');
}

/** Run a local fingerprint check; returns the first changed path, or null. */
function detectLocalDrift(
  visibleText: string,
  meta: { fingerprints?: Record<string, string>; regions?: Record<string, [number, number]> } | null,
): { changed: string[] } | null {
  if (!meta?.fingerprints || !meta?.regions) return null;
  const fps = fingerprintFields(visibleText, meta.regions);
  const changed: string[] = [];
  for (const path of Object.keys(meta.fingerprints)) {
    if (fps[path] !== meta.fingerprints[path]) changed.push(path);
  }
  return { changed };
}

export async function readPayloadHandler(
  args: unknown,
  deps: ReadPayloadDeps = {},
): Promise<ToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
    };
  }

  const { format, content, api_key } = parsed.data;
  const fetcher = deps.fetch ?? fetch;
  const isDocx = format === 'docx' || format === 'base64_docx';

  let buf: Buffer;
  try {
    buf = await resolveBytes(content, fetcher);
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to load document: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  let fields: GlyphFields | null;
  try {
    fields = isDocx ? extractFromDocx(buf) : extractFromPdf(buf);
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to parse document: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  if (!fields) {
    return NO_PAYLOAD_RESULT;
  }

  const {
    encrypted,
    iv,
    tag,
    signature,
    document_type,
    schema_version,
    signed_at,
    composition_id,
    block_ids,
  } = fields;

  // Verify signature
  let verified = false;
  try {
    verified = await verifySignature(encrypted, signature);
  } catch {
    // CryptoConfigError (missing env keys) — treat as unverified but still
    // attempt decryption so the data is returned with verified:false.
    verified = false;
  }

  // Decrypt payload
  let data: object;
  try {
    data = await decryptPayload(encrypted, iv, tag);
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            verified,
            error: `Decryption failed: ${err instanceof Error ? err.message : String(err)}`,
          }),
        },
      ],
    };
  }

  // Self-healing-sync: if `_meta` rode inside the encrypted payload, run a
  // local fingerprint check against the document's CURRENT visible text. If
  // any field drifted (or `_meta` is absent), defer to /api/v1/sync to get
  // freshly extracted data — otherwise return the cached payload for free.
  const meta = (data as { _meta?: { fingerprints?: Record<string, string>; regions?: Record<string, [number, number]> } })._meta ?? null;
  const visibleText = isDocx ? extractDocxVisibleText(buf) : extractPdfVisibleText(buf);
  const localDrift = detectLocalDrift(visibleText, meta);

  let status: 'in_sync' | 'synced' | 'sync_failed' | 'no_payload' = 'in_sync';
  let drift: { changed: string[]; added: string[]; removed: string[] } | null = null;
  let updatedFileB64: string | null = null;
  let finalData: object = data;

  const needsSync = !meta || (localDrift && localDrift.changed.length > 0);
  if (needsSync && deps.glyphApiUrl) {
    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(buf)], {
        type: isDocx
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf',
      });
      form.append('file', blob, isDocx ? 'document.docx' : 'document.pdf');
      const res = await fetcher(`${deps.glyphApiUrl}/api/v1/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${api_key}` },
        body: form,
      });
      if (res.ok) {
        const sync = (await res.json()) as {
          status: 'in_sync' | 'synced' | 'no_payload';
          data: object;
          drift: { changed: string[]; added: string[]; removed: string[] } | null;
          updated_file_b64: string | null;
        };
        status = sync.status;
        drift = sync.drift;
        updatedFileB64 = sync.updated_file_b64;
        if (sync.data) finalData = sync.data;
      } else {
        status = 'sync_failed';
      }
    } catch {
      status = 'sync_failed';
    }
  }

  const result: Record<string, unknown> = {
    verified,
    status,
    data: finalData,
    drift,
    updated_file_b64: updatedFileB64,
  };
  if (document_type !== undefined) result['document_type'] = document_type;
  if (schema_version !== undefined) result['schema_version'] = schema_version;
  if (signed_at !== undefined) result['signed_at'] = signed_at;
  result['composition_id'] = composition_id ?? null;
  result['block_ids'] = block_ids ?? null;

  console.log('[mcp:read_glyph_payload] done', {
    format,
    verified,
    document_type,
    status,
    drifted: drift?.changed.length ?? 0,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}
