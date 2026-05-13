/**
 * POST /api/mcp/generate
 *
 * Endpoint invoked by the @glyph/mcp-server `generate_structured_document`
 * tool. Authenticates with a user's API key (`Authorization: Bearer
 * sk_live_...`), validates the payload against the schema for
 * `document_type`, encrypts + signs it, renders a PDF (docx/gdocs are not
 * yet supported server-side and return 501), uploads the artifact to the
 * private `exports` bucket, and returns a 1-hour signed URL.
 *
 * The MCP server's shared-secret header (`x-glyph-mcp-secret`) is NOT
 * required here — the caller authenticates with the user's API key
 * directly, which is the unit of authorization.
 *
 * Does NOT persist to DB — the encrypted payload is embedded in the
 * generated PDF's XMP sidecar, which is the source of truth for
 * MCP-generated documents. Storing plaintext validated JSON in Postgres
 * would be a data-leak surface for no benefit.
 */

import { randomUUID } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { NextResponse, type NextRequest } from "next/server";

import { encryptPayload, signPayload } from "@glyph/crypto";
import type { GlyphDocument } from "@glyph/schema-library";

import { authenticateApiKey } from "@/lib/api-key-auth";
import { attachMeta, buildMeta } from "@/lib/payload-meta";
import { canonicalize } from "@/lib/canonicalize";
import { resolveSchema } from "@/server/documentRegistry";
import { EXPORTS_BUCKET, getSupabaseServiceClient } from "@/lib/supabase/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateBody {
  readonly document_type?: unknown;
  readonly structured_data?: unknown;
  readonly body_markdown?: unknown;
  readonly output_format?: unknown;
  readonly title?: unknown;
  readonly schema_version?: unknown;
  readonly schemaVersion?: unknown;
  readonly block_ids?: unknown;
}

// ---------------------------------------------------------------------------
// Minimal .docx builder (no external libraries — pure Node built-ins)
// A .docx is a ZIP of XML files. We build a ZIP with deflate compression
// using Node's built-in zlib.deflateRawSync.
// ---------------------------------------------------------------------------

const GLYPH_XML_NAMESPACE = "https://glyph.dev/schemas/v1";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Walk an arbitrary JSON value and emit (dotPath, leafValue) for every
 * non-container leaf. Object keys are preserved in canonical (sorted)
 * order — which is what `canonicalize` already produces.
 */
function walkLeaves(
  obj: unknown,
  prefix: string,
  emit: (path: string, value: unknown) => void,
): void {
  if (obj === null || typeof obj !== "object") {
    if (prefix.length > 0) emit(prefix, obj);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      walkLeaves(v, prefix.length > 0 ? `${prefix}.${i}` : String(i), emit);
    });
    return;
  }
  for (const k of Object.keys(obj)) {
    const v = (obj as Record<string, unknown>)[k];
    walkLeaves(v, prefix.length > 0 ? `${prefix}.${k}` : k, emit);
  }
}

interface StructuredPayload {
  documentType: string;
  schemaVersion: string;
  encrypted: string;
  iv: string;
  tag: string;
  signature: string;
  timestamp: string;
  /** Visible-text lines rendered in the docx body (one per leaf). */
  leafLines?: readonly string[];
  compositionId?: string | null;
  blockIds?: readonly string[] | null;
}

function buildStructuredXml(p: StructuredPayload): string {
  const compositionLine =
    p.compositionId !== undefined && p.compositionId !== null
      ? `  <CompositionId>${escapeXml(p.compositionId)}</CompositionId>\n`
      : "";
  const blockIdsLine =
    p.blockIds !== undefined && p.blockIds !== null && p.blockIds.length > 0
      ? `  <BlockIds>${escapeXml(p.blockIds.join(","))}</BlockIds>\n`
      : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<StructuredDocument xmlns="${GLYPH_XML_NAMESPACE}">\n` +
    `  <DocumentType>${escapeXml(p.documentType)}</DocumentType>\n` +
    `  <SchemaVersion>${escapeXml(p.schemaVersion)}</SchemaVersion>\n` +
    `  <EncryptedPayload>${escapeXml(p.encrypted)}</EncryptedPayload>\n` +
    `  <IV>${escapeXml(p.iv)}</IV>\n` +
    `  <Tag>${escapeXml(p.tag)}</Tag>\n` +
    `  <Signature>${escapeXml(p.signature)}</Signature>\n` +
    `  <Timestamp>${escapeXml(p.timestamp)}</Timestamp>\n` +
    compositionLine +
    blockIdsLine +
    `</StructuredDocument>`
  );
}

/** CRC-32 table for ZIP checksums */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ (buf[i] ?? 0)) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16LE(v: number): Buffer {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function writeUint32LE(v: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(v, 0);
  return b;
}

interface ZipEntry {
  name: string;
  data: Buffer;
  offset: number;
}

/**
 * Build a minimal ZIP archive from a map of filename → string content.
 * Uses DEFLATE compression via Node's built-in zlib.
 */
function buildZip(files: Record<string, string>): Buffer {
  const entries: ZipEntry[] = [];
  const localHeaders: Buffer[] = [];

  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(raw, { level: 6 });
    const crc = crc32(new Uint8Array(raw));
    const nameBytes = Buffer.from(name, "utf8");
    const offset = localHeaders.reduce((s, b) => s + b.length, 0) +
      entries.reduce((s, e) => s + e.data.length, 0);

    // Local file header (signature 0x04034b50)
    const lh = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      writeUint16LE(20),                  // version needed
      writeUint16LE(0),                   // flags
      writeUint16LE(8),                   // compression: deflate
      writeUint16LE(0),                   // mod time
      writeUint16LE(0),                   // mod date
      writeUint32LE(crc),
      writeUint32LE(compressed.length),
      writeUint32LE(raw.length),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),                   // extra length
      nameBytes,
    ]);

    entries.push({ name, data: compressed, offset });
    localHeaders.push(lh);
  }

  // Compute actual byte offsets
  let pos = 0;
  const localParts: Buffer[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const lh = localHeaders[i]!;
    entry.offset = pos;
    pos += lh.length + entry.data.length;
    localParts.push(lh, entry.data);
  }

  // Central directory — re-read crc/sizes from the already-built local header bytes
  const centralDir: Buffer[] = [];
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const lhIndex = entries.indexOf(entry) * 2;
    const lh = localParts[lhIndex]!;
    const crc = lh.readUInt32LE(14);
    const compressedSize = lh.readUInt32LE(18);
    const uncompressedSize = lh.readUInt32LE(22);

    const cdh = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      writeUint16LE(20),              // version made by
      writeUint16LE(20),              // version needed
      writeUint16LE(0),               // flags
      writeUint16LE(8),               // deflate
      writeUint16LE(0),               // mod time
      writeUint16LE(0),               // mod date
      writeUint32LE(crc),
      writeUint32LE(compressedSize),
      writeUint32LE(uncompressedSize),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),               // extra
      writeUint16LE(0),               // comment
      writeUint16LE(0),               // disk start
      writeUint16LE(0),               // internal attr
      writeUint32LE(0),               // external attr
      writeUint32LE(entry.offset),
      nameBytes,
    ]);
    centralDir.push(cdh);
  }

  const centralDirBuf = Buffer.concat(centralDir);
  const centralDirSize = centralDirBuf.length;
  const centralDirOffset = pos;

  // End of central directory
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    writeUint16LE(0),                       // disk number
    writeUint16LE(0),                       // disk with CD
    writeUint16LE(entries.length),          // entries on disk
    writeUint16LE(entries.length),          // total entries
    writeUint32LE(centralDirSize),
    writeUint32LE(centralDirOffset),
    writeUint16LE(0),                       // comment length
  ]);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

/**
 * Build a minimal valid .docx (Office Open XML) with:
 * - A document body containing the title as a heading
 * - A Custom XML Part carrying the Glyph structured payload
 */
function buildDocx(title: string, payload: StructuredPayload): Buffer {
  const customXml = buildStructuredXml(payload);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/customXml/item1.xml" ContentType="application/xml"/>
  <Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="customXml/item1.xml"/>
</Relationships>`;

  // Render each leaf as a `key: value` paragraph so the visible body
  // mirrors the structured payload. This lets drift detection compare the
  // body's text spans against the signed fingerprints — without it the
  // body is nominal and edits there produce no measurable drift.
  const renderedLeaves = payload.leafLines ?? [];
  const leafParagraphs = renderedLeaves
    .map((line) => `    <w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("\n");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>${escapeXml(title)}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Document Type: ${escapeXml(payload.documentType)}</w:t></w:r>
    </w:p>
${leafParagraphs}
    <w:sectPr/>
  </w:body>
</w:document>`;

  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const itemProps1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ds:datastoreItem ds:itemID="{GLYPH-STRUCTURED-DATA}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">
  <ds:schemaRefs>
    <ds:schemaRef ds:uri="${GLYPH_XML_NAMESPACE}"/>
  </ds:schemaRefs>
</ds:datastoreItem>`;

  const customXmlRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/>
</Relationships>`;

  return buildZip({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rootRels,
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": wordRels,
    "customXml/item1.xml": customXml,
    "customXml/itemProps1.xml": itemProps1,
    "customXml/_rels/item1.xml.rels": customXmlRels,
  });
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message, code: auth.code },
      { status: auth.status },
    );
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const documentType = body.document_type;
  if (typeof documentType !== "string" || documentType.trim().length === 0) {
    return badRequest("document_type is required.");
  }

  const outputFormat = body.output_format;
  if (outputFormat !== "pdf" && outputFormat !== "docx" && outputFormat !== "gdocs") {
    return badRequest("output_format must be one of: pdf, docx, gdocs.");
  }
  if (outputFormat === "gdocs") {
    return NextResponse.json(
      {
        error:
          "output_format=gdocs is not supported via MCP. Use the web UI export for Google Docs.",
      },
      { status: 501 },
    );
  }

  // Resolves blocks/composition first, then tenant custom types, then
  // compile-time built-ins. Optional `block_ids` lets agents pick the
  // exact schema slice they want — without it we use the domain default.
  const blockIds = Array.isArray(body.block_ids)
    ? (body.block_ids.filter((b): b is string => typeof b === "string"))
    : undefined;
  let resolved: Awaited<ReturnType<typeof resolveSchema>>;
  try {
    resolved = await resolveSchema({
      documentType,
      blockIds,
      userId: auth.key.userId,
    });
  } catch {
    return NextResponse.json(
      { error: `Unknown document type: "${documentType}". Register it in your Glyph account first.` },
      { status: 404 },
    );
  }
  const parsed = resolved.zod.safeParse(body.structured_data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "structured_data did not pass schema validation.",
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 422 },
    );
  }
  const document = parsed.data as GlyphDocument;

  const canonical = canonicalize(document);
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    return NextResponse.json(
      { error: "Canonical payload must be a JSON object." },
      { status: 500 },
    );
  }

  // Build a flat per-leaf rendering of the structured data so the visible
  // body and the signed payload share known text. We compute regions
  // against the SAME normalized text the docx text-extractor will produce
  // on read (paragraphs joined with "\n"), so the fingerprints survive a
  // round-trip through the file format.
  const renderedLines: string[] = [];
  const leafEntries: Array<{ path: string; text: string }> = [];
  walkLeaves(canonical as Record<string, unknown>, "", (path, value) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    renderedLines.push(`${path}: ${text}`);
    leafEntries.push({ path, text });
  });
  // Match what the extractor produces: the title paragraph + the
  // "Document Type: …" paragraph come BEFORE the leaf paragraphs, joined
  // with "\n" between paragraphs.
  const titlePara = typeof body.title === "string" ? body.title : documentType;
  const docTypePara = `Document Type: ${documentType}`;
  const fullSource = [titlePara, docTypePara, ...renderedLines].join("\n");

  // Only register regions for "safe" leaves: short single-line scalars
  // whose substring uniquely locates them in the rendered text. Skip
  // multi-line or punctuation-heavy values to avoid false-positive drift
  // when the docx text-extractor normalizes whitespace differently.
  const leafRegions: Record<string, [number, number]> = {};
  for (const { path, text } of leafEntries) {
    if (text.length === 0 || text.length > 256) continue;
    if (/[\r\n\t]/.test(text)) continue;
    const needle = `${path}: ${text}`;
    const idx = fullSource.indexOf(needle);
    if (idx < 0) continue;
    if (fullSource.indexOf(needle, idx + 1) >= 0) continue; // not unique
    const valStart = idx + path.length + 2;
    leafRegions[path] = [valStart, valStart + text.length];
  }
  const sourceText = fullSource;

  // Schema version: prefer explicit body.schemaVersion, fall back to document
  // field, then default to "1.0".
  const schemaVersionEarly: string =
    typeof body.schemaVersion === "string"
      ? body.schemaVersion
      : typeof (document as { schema_version?: unknown }).schema_version === "string"
        ? (document as { schema_version: string }).schema_version
        : "1.0";

  const meta = buildMeta({
    sourceText,
    regions: leafRegions,
    schemaVersion: schemaVersionEarly,
    blockIds: resolved.blockIds,
    compositionId: resolved.compositionId,
  });
  const withMeta = attachMeta(canonical as Record<string, unknown>, meta);

  const { encrypted, iv, tag } = await encryptPayload(withMeta);
  const signature = await signPayload(encrypted);

  const schemaVersion = schemaVersionEarly;

  // No DB persistence: the artifact sidecar carries the encrypted payload.
  // Generate a transient document id for the storage path / response only.
  const documentId = randomUUID();
  const timestamp = new Date().toISOString();

  const payloadMeta: StructuredPayload = {
    documentType,
    schemaVersion,
    encrypted,
    iv,
    tag,
    signature,
    timestamp,
    leafLines: renderedLines,
    compositionId: resolved.compositionId,
    blockIds: resolved.blockIds,
  };

  let fileBytes: Buffer;
  let contentType: string;
  let ext: string;

  if (outputFormat === "docx") {
    const title = typeof body.title === "string" ? body.title : documentType;
    const bodyMarkdown =
      typeof body.body_markdown === "string" && body.body_markdown.length > 0
        ? body.body_markdown
        : null;

    if (bodyMarkdown) {
      // PROFESSIONAL PATH: AI provided markdown — render with docx-js for
      // real Word formatting (headings, bold, lists, tables), then inject
      // our signed custom XML part.
      const { renderMarkdownToDocx, injectGlyphCustomXml } = await import(
        "@/lib/docx/markdown-to-docx"
      );
      const baseDocx = await renderMarkdownToDocx({ title, bodyMarkdown });
      const customXml = buildStructuredXml(payloadMeta);
      fileBytes = injectGlyphCustomXml({ docxBytes: baseDocx, customXml });
    } else {
      // FALLBACK PATH: no markdown — minimal `path: value` layout. Useful
      // for machine-only documents; ugly for humans (see MCP tool
      // description — body_markdown is strongly recommended).
      fileBytes = buildDocx(title, payloadMeta);
    }

    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    ext = "docx";
  } else {
    // PDF path — unchanged
    const { generatePdf } = await import("@/lib/pdf");
    const pdfBytes = await generatePdf({
      document,
      xmp: payloadMeta,
    });
    fileBytes = Buffer.from(pdfBytes);
    contentType = "application/pdf";
    ext = "pdf";
  }

  const supabase = getSupabaseServiceClient();
  const path = `${auth.key.userId}/${documentId}-${Date.now()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from(EXPORTS_BUCKET)
    .upload(path, fileBytes, { contentType, upsert: false });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const EXPIRES_IN = 60 * 60;
  const { data: signed, error: signErr } = await supabase.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(path, EXPIRES_IN);
  if (signErr || !signed) {
    return NextResponse.json(
      { error: `Could not sign URL: ${signErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    downloadUrl: signed.signedUrl,
    expiresIn: EXPIRES_IN,
    documentId,
  });
}
