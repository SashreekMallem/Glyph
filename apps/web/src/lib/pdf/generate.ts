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

import type {
  Contract,
  Invoice,
  Resume,
  GlyphDocument,
} from "@glyph/schema-library";

import { injectGlyphXmp } from "./inject";
import type { GlyphXmpMetadata } from "./xmp";

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

function formatDate(iso: string): string {
  // Dates come in as ISO-8601 full-date. Render as "Jan 5, 2025" without
  // any locale-sensitive surprises.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const label = MONTHS[month - 1] ?? String(month);
  return `${label} ${day}, ${year}`;
}

function formatMoney(amount: number, currency: string): string {
  // Currency is 3-letter ISO; no fancy locale formatting.
  const whole = Math.trunc(amount);
  const cents = Math.round((amount - whole) * 100);
  const centsStr = cents.toString().padStart(2, "0");
  return `${currency.toUpperCase()} ${whole.toLocaleString("en-US")}.${centsStr}`;
}

// ---------------------------------------------------------------------------
// Contract renderer
// ---------------------------------------------------------------------------

export async function renderContract(doc: Contract): Promise<PDFDocument> {
  const footer = `Generated with Glyph · ${doc.document_type.toUpperCase()}`;
  const cursor = await newDocument(footer);

  drawTitle(cursor, "Contract Agreement");
  drawMeta(
    cursor,
    `Effective ${formatDate(doc.effective_date)}` +
      (doc.expiry_date ? ` — Expires ${formatDate(doc.expiry_date)}` : ""),
  );

  drawHeading(cursor, "Parties");
  for (const party of doc.parties) {
    const roleLabel = party.role.charAt(0).toUpperCase() + party.role.slice(1);
    drawText(cursor, `${party.name}`, { font: cursor.fonts.bold });
    drawMeta(
      cursor,
      [roleLabel, party.address, party.email].filter(Boolean).join(" · "),
    );
  }

  if (doc.payment_terms) {
    drawHeading(cursor, "Payment Terms");
    const pt = doc.payment_terms;
    const lines: string[] = [];
    if (pt.amount !== undefined && pt.currency !== undefined) {
      lines.push(`Amount: ${formatMoney(pt.amount, pt.currency)}`);
    } else if (pt.amount !== undefined) {
      lines.push(`Amount: ${pt.amount}`);
    }
    if (pt.schedule !== undefined) lines.push(`Schedule: ${pt.schedule}`);
    if (pt.due_days !== undefined) lines.push(`Due in: ${pt.due_days} days`);
    for (const line of lines) drawText(cursor, line);
  }

  if (doc.obligations.length > 0) {
    drawHeading(cursor, "Obligations");
    for (const ob of doc.obligations) {
      drawText(cursor, `${ob.party}`, { font: cursor.fonts.bold });
      drawText(cursor, ob.description, { indent: 12 });
      if (ob.deadline !== undefined) {
        drawMeta(cursor, `Deadline: ${formatDate(ob.deadline)}`);
      }
    }
  }

  drawHeading(cursor, "Governing Law");
  drawText(cursor, doc.governing_law);

  if (doc.termination_notice_days !== undefined) {
    drawHeading(cursor, "Termination");
    drawText(
      cursor,
      `Either party may terminate with ${doc.termination_notice_days} days written notice.`,
    );
  }

  drawHeading(cursor, "Confidentiality");
  drawText(
    cursor,
    doc.confidentiality
      ? "This agreement is confidential between the parties."
      : "No confidentiality clause applies.",
  );

  return finalize(cursor);
}

// ---------------------------------------------------------------------------
// Resume renderer
// ---------------------------------------------------------------------------

export async function renderResume(doc: Resume): Promise<PDFDocument> {
  const footer = `Generated with Glyph · RESUME`;
  const cursor = await newDocument(footer);

  drawTitle(cursor, doc.personal.full_name);
  const personalBits: string[] = [doc.personal.email];
  if (doc.personal.phone) personalBits.push(doc.personal.phone);
  if (doc.personal.location) personalBits.push(doc.personal.location);
  if (doc.personal.website) personalBits.push(doc.personal.website);
  if (doc.personal.linkedin) personalBits.push(doc.personal.linkedin);
  drawMeta(cursor, personalBits.join(" · "));

  if (doc.summary) {
    drawHeading(cursor, "Summary");
    drawText(cursor, doc.summary);
  }

  if (doc.experience.length > 0) {
    drawHeading(cursor, "Experience");
    for (const exp of doc.experience) {
      drawText(cursor, `${exp.title} — ${exp.company}`, {
        font: cursor.fonts.bold,
      });
      const range =
        formatDate(exp.start_date) +
        " — " +
        (exp.end_date ? formatDate(exp.end_date) : "Present");
      drawMeta(cursor, [range, exp.location].filter(Boolean).join(" · "));
      drawText(cursor, exp.description);
      if (exp.achievements && exp.achievements.length > 0) {
        for (const a of exp.achievements) {
          drawText(cursor, `• ${a}`, { indent: 12 });
        }
      }
    }
  }

  if (doc.education.length > 0) {
    drawHeading(cursor, "Education");
    for (const ed of doc.education) {
      const title =
        ed.degree + (ed.field !== undefined ? ` in ${ed.field}` : "");
      drawText(cursor, `${title} — ${ed.institution}`, {
        font: cursor.fonts.bold,
      });
      const bits: string[] = [];
      if (ed.graduation_year !== undefined) bits.push(String(ed.graduation_year));
      if (ed.gpa !== undefined) bits.push(`GPA ${ed.gpa.toFixed(2)}`);
      if (bits.length > 0) drawMeta(cursor, bits.join(" · "));
    }
  }

  if (doc.skills.length > 0) {
    drawHeading(cursor, "Skills");
    for (const group of doc.skills) {
      drawText(cursor, `${group.category}: ${group.items.join(", ")}`);
    }
  }

  if (doc.certifications && doc.certifications.length > 0) {
    drawHeading(cursor, "Certifications");
    for (const cert of doc.certifications) {
      drawText(cursor, `${cert.name} — ${cert.issuer}`, {
        font: cursor.fonts.bold,
      });
      const bits: string[] = [];
      if (cert.issued_date) bits.push(`Issued ${formatDate(cert.issued_date)}`);
      if (cert.expires_date)
        bits.push(`Expires ${formatDate(cert.expires_date)}`);
      if (bits.length > 0) drawMeta(cursor, bits.join(" · "));
    }
  }

  return finalize(cursor);
}

// ---------------------------------------------------------------------------
// Invoice renderer
// ---------------------------------------------------------------------------

export async function renderInvoice(doc: Invoice): Promise<PDFDocument> {
  const footer = `Generated with Glyph · Invoice ${doc.invoice_number}`;
  const cursor = await newDocument(footer);

  drawTitle(cursor, `Invoice ${doc.invoice_number}`);
  drawMeta(
    cursor,
    `Issued ${formatDate(doc.issue_date)} · Due ${formatDate(doc.due_date)}`,
  );

  drawHeading(cursor, "From");
  drawText(cursor, doc.vendor.name, { font: cursor.fonts.bold });
  for (const line of [doc.vendor.address, doc.vendor.email, doc.vendor.phone, doc.vendor.tax_id]) {
    if (line !== undefined) drawMeta(cursor, line);
  }

  drawHeading(cursor, "Bill To");
  drawText(cursor, doc.bill_to.name, { font: cursor.fonts.bold });
  for (const line of [
    doc.bill_to.address,
    doc.bill_to.email,
    doc.bill_to.phone,
    doc.bill_to.tax_id,
  ]) {
    if (line !== undefined) drawMeta(cursor, line);
  }

  drawHeading(cursor, "Line Items");
  for (const item of doc.line_items) {
    drawText(cursor, item.description, { font: cursor.fonts.bold });
    drawMeta(
      cursor,
      `${item.quantity} × ${formatMoney(item.unit_price, doc.currency)}  =  ${formatMoney(item.total, doc.currency)}`,
    );
  }

  drawHeading(cursor, "Totals");
  drawText(cursor, `Subtotal: ${formatMoney(doc.subtotal, doc.currency)}`);
  if (doc.tax_amount !== undefined) {
    const ratePct =
      doc.tax_rate !== undefined ? ` (${(doc.tax_rate * 100).toFixed(2)}%)` : "";
    drawText(cursor, `Tax${ratePct}: ${formatMoney(doc.tax_amount, doc.currency)}`);
  }
  drawText(cursor, `Total: ${formatMoney(doc.total, doc.currency)}`, {
    font: cursor.fonts.bold,
  });

  if (doc.payment_instructions) {
    drawHeading(cursor, "Payment Instructions");
    drawText(cursor, doc.payment_instructions);
  }
  if (doc.notes) {
    drawHeading(cursor, "Notes");
    drawText(cursor, doc.notes);
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

/** Render the given document and inject the supplied XMP metadata. */
export async function generatePdf(
  options: GeneratePdfOptions,
): Promise<Uint8Array> {
  const { document, xmp } = options;
  let pdfDoc: PDFDocument;
  switch (document.document_type) {
    case "contract":
      pdfDoc = await renderContract(document);
      break;
    case "resume":
      pdfDoc = await renderResume(document);
      break;
    case "invoice":
      pdfDoc = await renderInvoice(document);
      break;
  }
  injectGlyphXmp(pdfDoc, xmp);
  return pdfDoc.save();
}
