/**
 * File I/O for the self-healing-sync pipeline.
 *
 * Two formats: .docx (Office Open XML, ZIP container with Custom XML Part)
 * and .pdf (XMP metadata stream). Both are parsed for the embedded Glyph
 * fields and the visible text body, then re-bundled with refreshed
 * embedded fields after a sync.
 *
 * PDF text extraction is best-effort — sufficient for Glyph-generated
 * docs but not a full PDF parser.
 */

import { unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

import {
  extractXmp,
  injectGlyphXmp,
  type GlyphXmpMetadata,
} from "@/lib/pdf";

const GLYPH_NS = "https://glyph.dev/schemas/v1";

export interface EmbeddedFields {
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
  readonly signature: string;
  readonly documentType: string;
  readonly schemaVersion: string;
  readonly timestamp?: string;
  readonly compositionId?: string | null;
  readonly blockIds?: readonly string[] | null;
}

export interface ParsedBundle {
  readonly visibleText: string;
  readonly embedded: EmbeddedFields | null;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function extractElement(xml: string, localName: string): string | null {
  const patterns = [
    new RegExp(`<[^>]*:${localName}[^>]*>([^<]*)<\\/[^>]*:${localName}>`, "s"),
    new RegExp(`<${localName}[^>]*>([^<]*)<\\/${localName}>`, "s"),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m && typeof m[1] === "string" && m[1].trim().length > 0) {
      return m[1].trim();
    }
  }
  return null;
}

function parseGlyphXml(xml: string): EmbeddedFields | null {
  if (!xml.includes(GLYPH_NS) && !xml.includes("EncryptedPayload")) return null;
  const encrypted = extractElement(xml, "EncryptedPayload");
  const iv = extractElement(xml, "IV");
  const tag = extractElement(xml, "Tag");
  const signature = extractElement(xml, "Signature");
  if (!encrypted || !iv || !tag || !signature) return null;
  const blockIdsRaw = extractElement(xml, "BlockIds");
  return {
    encrypted,
    iv,
    tag,
    signature,
    documentType: extractElement(xml, "DocumentType") ?? "",
    schemaVersion: extractElement(xml, "SchemaVersion") ?? "1.0",
    timestamp: extractElement(xml, "Timestamp") ?? undefined,
    compositionId: extractElement(xml, "CompositionId") ?? null,
    blockIds: blockIdsRaw
      ? blockIdsRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : null,
  };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

/**
 * Strip OOXML markup to plain text. Walks `<w:t>` runs and inserts
 * paragraph breaks between `<w:p>` elements. Good enough for drift
 * detection — exact byte offsets must come from the original plugin
 * regions, not from this extractor.
 */
function unescapeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function docxBodyToText(documentXml: string): string {
  const paragraphs = documentXml.split(/<w:p[\s>]/);
  const out: string[] = [];
  for (const p of paragraphs) {
    const runs = p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
    const parts: string[] = [];
    for (const run of runs) parts.push(unescapeXmlText(run[1] ?? ""));
    if (parts.length > 0) out.push(parts.join(""));
  }
  return out.join("\n");
}

export function parseDocxBundle(buf: Uint8Array): ParsedBundle {
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(buf);
  } catch {
    throw new Error("Could not unzip .docx — file may be corrupt.");
  }

  let embedded: EmbeddedFields | null = null;
  for (const [path, data] of Object.entries(files)) {
    if (/^customXml\/item\d*\.xml$/i.test(path)) {
      const xml = Buffer.from(data).toString("utf8");
      const fields = parseGlyphXml(xml);
      if (fields) {
        embedded = fields;
        break;
      }
    }
  }
  if (!embedded) {
    for (const [path, data] of Object.entries(files)) {
      if (path.endsWith(".xml")) {
        const xml = Buffer.from(data).toString("utf8");
        if (xml.includes(GLYPH_NS) || xml.includes("EncryptedPayload")) {
          const fields = parseGlyphXml(xml);
          if (fields) {
            embedded = fields;
            break;
          }
        }
      }
    }
  }

  const documentXml = files["word/document.xml"];
  const visibleText = documentXml
    ? docxBodyToText(Buffer.from(documentXml).toString("utf8"))
    : "";

  return { visibleText, embedded };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildGlyphCustomXml(fields: EmbeddedFields): string {
  const compositionLine =
    fields.compositionId
      ? `  <CompositionId>${escapeXml(fields.compositionId)}</CompositionId>\n`
      : "";
  const blockIdsLine =
    fields.blockIds && fields.blockIds.length > 0
      ? `  <BlockIds>${escapeXml(fields.blockIds.join(","))}</BlockIds>\n`
      : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<StructuredDocument xmlns="${GLYPH_NS}">\n` +
    `  <DocumentType>${escapeXml(fields.documentType)}</DocumentType>\n` +
    `  <SchemaVersion>${escapeXml(fields.schemaVersion)}</SchemaVersion>\n` +
    `  <EncryptedPayload>${escapeXml(fields.encrypted)}</EncryptedPayload>\n` +
    `  <IV>${escapeXml(fields.iv)}</IV>\n` +
    `  <Tag>${escapeXml(fields.tag)}</Tag>\n` +
    `  <Signature>${escapeXml(fields.signature)}</Signature>\n` +
    `  <Timestamp>${escapeXml(fields.timestamp ?? new Date().toISOString())}</Timestamp>\n` +
    compositionLine +
    blockIdsLine +
    `</StructuredDocument>`
  );
}

/**
 * Re-bundle a .docx with refreshed embedded fields. Preserves all original
 * parts (visible body, styles, etc.) and only replaces the Glyph custom-xml
 * item.
 */
export function rebuildDocx(
  originalBuf: Uint8Array,
  newFields: EmbeddedFields,
): Buffer {
  const files = unzipSync(originalBuf);
  const newCustomXml = new TextEncoder().encode(buildGlyphCustomXml(newFields));

  let target: string | null = null;
  for (const path of Object.keys(files)) {
    if (/^customXml\/item\d*\.xml$/i.test(path)) {
      const xml = Buffer.from(files[path]!).toString("utf8");
      if (xml.includes(GLYPH_NS) || xml.includes("EncryptedPayload")) {
        target = path;
        break;
      }
    }
  }
  if (!target) target = "customXml/item1.xml";
  files[target] = newCustomXml;

  return Buffer.from(zipSync(files));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * Best-effort PDF text extraction: scans for `(literal) Tj` and `[ ... ] TJ`
 * operators inside `BT ... ET` text blocks. Sufficient for Glyph-generated
 * PDFs whose text is laid out by `pdf-lib`.
 */
function pdfBodyToText(pdfBytes: Uint8Array): string {
  const text = Buffer.from(pdfBytes).toString("latin1");
  const out: string[] = [];
  const blockRe = /BT([\s\S]*?)ET/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const block = m[1] ?? "";
    const tjRe = /\(((?:[^()\\]|\\[\s\S])*)\)\s*Tj/g;
    let tj: RegExpExecArray | null;
    while ((tj = tjRe.exec(block)) !== null) {
      out.push((tj[1] ?? "").replace(/\\([\\()])/g, "$1"));
    }
    out.push("\n");
  }
  return out.join("");
}

export function parsePdfBundle(buf: Uint8Array): ParsedBundle {
  const xmp = extractXmp(buf);
  const embedded: EmbeddedFields | null = xmp
    ? {
        encrypted: xmp.encrypted,
        iv: xmp.iv,
        tag: xmp.tag,
        signature: xmp.signature,
        documentType: xmp.documentType,
        schemaVersion: xmp.schemaVersion,
        timestamp: xmp.timestamp,
        compositionId: xmp.compositionId ?? null,
        blockIds: xmp.blockIds ?? null,
      }
    : null;
  return { visibleText: pdfBodyToText(buf), embedded };
}

export async function rebuildPdf(
  originalBuf: Uint8Array,
  newFields: EmbeddedFields,
): Promise<Buffer> {
  const doc = await PDFDocument.load(originalBuf);
  const xmpMeta: GlyphXmpMetadata = {
    documentType: newFields.documentType,
    schemaVersion: newFields.schemaVersion,
    encrypted: newFields.encrypted,
    iv: newFields.iv,
    tag: newFields.tag,
    signature: newFields.signature,
    timestamp: newFields.timestamp ?? new Date().toISOString(),
    compositionId: newFields.compositionId ?? null,
    blockIds: newFields.blockIds ?? null,
  };
  injectGlyphXmp(doc, xmpMeta);
  return Buffer.from(await doc.save());
}
