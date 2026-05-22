/**
 * Visual PDF generation for Glyph documents.
 *
 * Every renderer is strictly typed against its document schema and
 * produces a clean, premium-minimalist layout: Helvetica, generous
 * 1-inch margins, monochrome with gray for secondary text.
 *
 * All renderers support pagination via a shared {@link LayoutCursor}:
 * writing a line below the bottom margin automatically spills onto a
 * fresh page.
 */

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

import { injectGlyphXmp } from "./inject";
import type { GlyphXmpMetadata } from "./xmp";

// Document payloads are arbitrary, schema-driven JSON objects — the
// hardcoded `Contract`/`Resume`/`Invoice` Zod types are gone and every
// schema now lives in the `document_types` DB table. The generic
// renderer walks the validated payload recursively and produces a
// reasonable layout for any shape.
type GlyphDocument = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Layout constants — premium minimalist.
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 612; // US Letter, 8.5in × 72.
const PAGE_HEIGHT = 792; // US Letter, 11in × 72.
const MARGIN = 72; // 1 inch.
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const TITLE_SIZE = 24;
const HEADING_SIZE = 14;
const BODY_SIZE = 10;
const META_SIZE = 9;
const FOOTER_SIZE = 8;

const TITLE_LEADING = 30;
const HEADING_LEADING = 20;
const BODY_LEADING = 14;
const SECTION_GAP = 10;

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.42, 0.42, 0.42);
const LIGHT_GRAY = rgb(0.75, 0.75, 0.75);

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
}

interface LayoutCursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  pageIndex: number;
  readonly fonts: Fonts;
  readonly footer: string;
}

function newPage(cursor: LayoutCursor): void {
  drawFooter(cursor);
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.pageIndex += 1;
  cursor.y = PAGE_HEIGHT - MARGIN;
}

function ensureSpace(cursor: LayoutCursor, lineHeight: number): void {
  if (cursor.y - lineHeight < MARGIN + 30) {
    newPage(cursor);
  }
}

/** Wrap `text` into lines that fit within `maxWidth` at `size`. */
function wrapLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  // Normalise whitespace and split on words; preserve explicit newlines.
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const attempt = current.length === 0 ? word : `${current} ${word}`;
      const width = font.widthOfTextAtSize(attempt, size);
      if (width <= maxWidth) {
        current = attempt;
      } else {
        if (current.length > 0) lines.push(current);
        // Hard-break ultra-long words character-by-character.
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let buf = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(buf + ch, size) > maxWidth) {
              lines.push(buf);
              buf = ch;
            } else {
              buf += ch;
            }
          }
          current = buf;
        } else {
          current = word;
        }
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines;
}

interface TextOptions {
  readonly font?: PDFFont;
  readonly size?: number;
  readonly color?: ReturnType<typeof rgb>;
  readonly leading?: number;
  readonly indent?: number;
}

function drawText(
  cursor: LayoutCursor,
  text: string,
  opts: TextOptions = {},
): void {
  const font = opts.font ?? cursor.fonts.regular;
  const size = opts.size ?? BODY_SIZE;
  const color = opts.color ?? BLACK;
  const leading = opts.leading ?? BODY_LEADING;
  const indent = opts.indent ?? 0;
  const lines = wrapLines(text, font, size, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(cursor, leading);
    cursor.page.drawText(line, {
      x: MARGIN + indent,
      y: cursor.y - size,
      font,
      size,
      color,
    });
    cursor.y -= leading;
  }
}

function drawHeading(cursor: LayoutCursor, text: string): void {
  cursor.y -= SECTION_GAP;
  ensureSpace(cursor, HEADING_LEADING + 6);
  // Thin rule above heading, for visual separation.
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y + 2 },
    end: { x: PAGE_WIDTH - MARGIN, y: cursor.y + 2 },
    thickness: 0.5,
    color: LIGHT_GRAY,
  });
  drawText(cursor, text, {
    font: cursor.fonts.bold,
    size: HEADING_SIZE,
    leading: HEADING_LEADING,
  });
}

function drawTitle(cursor: LayoutCursor, text: string): void {
  drawText(cursor, text, {
    font: cursor.fonts.bold,
    size: TITLE_SIZE,
    leading: TITLE_LEADING,
  });
}

function drawMeta(cursor: LayoutCursor, text: string): void {
  drawText(cursor, text, { size: META_SIZE, color: GRAY, leading: 12 });
}

function drawFooter(cursor: LayoutCursor): void {
  const text = cursor.footer;
  cursor.page.drawText(text, {
    x: MARGIN,
    y: MARGIN / 2,
    font: cursor.fonts.regular,
    size: FOOTER_SIZE,
    color: GRAY,
  });
  const right = `Page ${cursor.pageIndex}`;
  const w = cursor.fonts.regular.widthOfTextAtSize(right, FOOTER_SIZE);
  cursor.page.drawText(right, {
    x: PAGE_WIDTH - MARGIN - w,
    y: MARGIN / 2,
    font: cursor.fonts.regular,
    size: FOOTER_SIZE,
    color: GRAY,
  });
}

async function newDocument(footer: string): Promise<LayoutCursor> {
  const doc = await PDFDocument.create();
  doc.setProducer("Glyph");
  doc.setCreator("Glyph");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return {
    doc,
    page,
    y: PAGE_HEIGHT - MARGIN,
    pageIndex: 1,
    fonts: { regular, bold },
    footer,
  };
}

function finalize(cursor: LayoutCursor): PDFDocument {
  drawFooter(cursor);
  return cursor.doc;
}

// ---------------------------------------------------------------------------
// Generic renderer for schema-driven documents
//
// The hardcoded contract/resume/invoice renderers have been removed —
// schemas live in the DB now, so every document type is rendered by the
// recursive `renderGeneric` walker below.
// ---------------------------------------------------------------------------

async function renderGenericNode(
  cursor: LayoutCursor,
  key: string,
  value: unknown,
  depth: number = 0,
): Promise<void> {
  if (value === null || value === undefined) return;
  const indent = depth * 12;
  const label = key
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");

  // Handle Arrays (Experience lists, skills, achievements)
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    // Don't draw a label for root-level simple arrays if depth is high
    if (depth > 0 || !/^\d+$/.test(key)) {
      drawText(cursor, label, { font: cursor.fonts.bold, indent });
    }
    for (const item of value) {
      if (typeof item === "string") {
        drawText(cursor, `• ${item}`, { indent: indent + 12 });
      } else {
        await renderGenericNode(cursor, "", item, depth + 1);
        cursor.y -= 4; // Slight gap between items
      }
    }
    return;
  }

  // Handle Objects (Experience entries, personal_info)
  if (typeof value === "object") {
    if (label && !/^\d+$/.test(key) && key !== "") {
      drawText(cursor, label, { font: cursor.fonts.bold, indent });
    }
    for (const [k, v] of Object.entries(value)) {
      if (k === "__ease__" || k === "display_order") continue;
      await renderGenericNode(cursor, k, v, depth + 1);
    }
    return;
  }

  // Handle Primitive Leaf Nodes (Title, Date, Description)
  const displayValue = String(value).trim();
  if (!displayValue) return;

  if (key === "" || /^\d+$/.test(key)) {
    drawText(cursor, displayValue, { indent });
  } else {
    drawText(cursor, `${label}: ${displayValue}`, { indent });
  }
}

function readString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readNestedString(
  obj: GlyphDocument,
  key: string,
  child: string,
): string | undefined {
  const outer = obj[key];
  if (outer === null || typeof outer !== "object" || Array.isArray(outer)) {
    return undefined;
  }
  return readString((outer as Record<string, unknown>)[child]);
}

export async function renderGeneric(doc: GlyphDocument): Promise<PDFDocument> {
  const typeLabel = (readString(doc.document_type) ?? "custom").toUpperCase();
  const footer = `Generated with Glyph · ${typeLabel}`;
  const cursor = await newDocument(footer);

  // 1. Title / Header
  const title =
    readNestedString(doc, "personal_info", "name") ??
    readString(doc.name) ??
    "Document Summary";
  drawTitle(cursor, title);

  const metaBits: string[] = [];
  const email = readNestedString(doc, "personal_info", "email");
  if (email) metaBits.push(email);
  const phone = readNestedString(doc, "personal_info", "phone");
  if (phone) metaBits.push(phone);
  const location = readNestedString(doc, "personal_info", "location");
  if (location) metaBits.push(location);

  if (metaBits.length > 0) {
    drawMeta(cursor, metaBits.join(" · "));
  }

  // 2. Recursive Content Rendering
  // We skip only the internal system metadata.
  const systemFields = ["document_type", "schema_version", "_meta", "id", "userId", "updatedAt", "createdAt"];
  const entries = Object.entries(doc)
    .filter(([k]) => !systemFields.includes(k))
    .sort((a, b) => {
      // Prioritize summary and personal_info at the top
      if (a[0] === "summary" || a[0] === "personal_info") return -1;
      if (b[0] === "summary" || b[0] === "personal_info") return 1;
      return a[0].localeCompare(b[0]);
    });

  for (const [k, v] of entries) {
    if (v === null || v === undefined) continue;

    // Summary gets special treatment as a lead-in
    if (k === "summary" && typeof v === "string") {
      drawHeading(cursor, "Summary");
      drawText(cursor, v);
      cursor.y -= SECTION_GAP;
      continue;
    }

    // Otherwise, render the node and its children
    await renderGenericNode(cursor, k, v, 0);
    cursor.y -= SECTION_GAP;
  }

  return finalize(cursor);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface GeneratePdfOptions {
  readonly document: GlyphDocument;
  readonly xmp: GlyphXmpMetadata;
}

/** Render the given document and inject the supplied XMP metadata.
 *
 * All schemas now resolve via the DB-backed registry, so the renderer
 * walks the validated payload generically — there are no per-type
 * compile-time layouts anymore. */
export async function generatePdf(
  options: GeneratePdfOptions,
): Promise<Uint8Array> {
  const { document, xmp } = options;
  const pdfDoc = await renderGeneric(document);
  injectGlyphXmp(pdfDoc, xmp);
  return pdfDoc.save();
}
