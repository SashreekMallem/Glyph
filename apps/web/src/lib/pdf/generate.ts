/**
 * Visual PDF generation for Glyph documents.
 *
 * Every renderer is strictly typed against its document schema and
 * produces a clean, premium-minimalist layout. Typography and color
 * now come from the active `StyleProfile` — Glyph Modern when the
 * caller doesn't pass one, otherwise the document's saved profile.
 *
 * All renderers support pagination via a shared {@link LayoutCursor}:
 * writing a line below the bottom margin automatically spills onto a
 * fresh page.
 *
 * TODO: Phase D — load Google Fonts via fontkit for exact font fidelity.
 * Today pdf-lib's StandardFonts give us the right typographic class
 * (serif/sans/mono) but not the exact face the StyleProfile names.
 */

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

import {
  GLYPH_MODERN_PROFILE,
  profileToRgb,
  type StyleProfile,
} from "@glyph/style-profile";

import { injectGlyphXmp } from "./inject";
import type { GlyphXmpMetadata } from "./xmp";

// Document payloads are arbitrary, schema-driven JSON objects — the
// hardcoded `Contract`/`Resume`/`Invoice` Zod types are gone and every
// schema now lives in the `document_types` DB table. The generic
// renderer walks the validated payload recursively and produces a
// reasonable layout for any shape.
type GlyphDocument = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Layout constants — the page geometry is fixed (US Letter) but every
// font, size, and color is now derived from a StyleProfile at render
// time. The constants below are intentional fallbacks used in places
// where pdf-lib needs a sane number before the profile is in scope.
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 612; // US Letter, 8.5in × 72.
const PAGE_HEIGHT = 792; // US Letter, 11in × 72.

// Footer + meta sizes stay constant. They sit OUTSIDE the body type
// stack — too small for the profile's `small` size to control well.
const META_SIZE = 9;
const FOOTER_SIZE = 8;

// ---------------------------------------------------------------------------
// Font mapping — pdf-lib's 14 standard fonts can't perfectly impersonate
// the profile's named family, but they give us the right typographic
// CLASS (serif / sans / mono). Phase D will load real Google Fonts via
// fontkit for exact fidelity.
// ---------------------------------------------------------------------------

const SERIF_FAMILIES = new Set([
  "Georgia",
  "Times New Roman",
  "Palatino",
  "Garamond",
  "Source Serif Pro",
  "Merriweather",
  "Crimson Text",
  "Crimson Pro",
  "PT Serif",
  "Playfair Display",
  "Lora",
  "Cormorant Garamond",
  "Libre Baskerville",
  "EB Garamond",
  "Spectral",
  "Bitter",
  "Vollkorn",
  "IBM Plex Serif",
  "DM Serif Display",
  "Abril Fatface",
  "Fraunces",
]);

const MONO_FAMILIES = new Set([
  "Courier New",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Roboto Mono",
  "Space Mono",
  "IBM Plex Mono",
  "Inconsolata",
]);

type FontRole = "body" | "heading" | "mono";

/**
 * Translate a profile-provided font name into one of pdf-lib's 14
 * built-in StandardFonts. The choice preserves the typographic CLASS
 * (serif vs sans vs mono) and the requested weight (heading roles use
 * the bold variant of their class).
 *
 * Unknown sans-y names fall through to Helvetica, unknown serif-y to
 * Times Roman, unknown mono to Courier. The default for a *body* role
 * (where most "I don't recognise this" cases land) is Times Roman, per
 * the Phase B spec.
 */
export function mapProfileFontToStandard(
  fontName: string,
  role: FontRole,
): StandardFonts {
  const isMono = MONO_FAMILIES.has(fontName);
  const isSerif = SERIF_FAMILIES.has(fontName);

  if (role === "mono" || isMono) {
    return role === "heading" || isMono
      ? StandardFonts.CourierBold
      : StandardFonts.Courier;
  }

  if (role === "heading") {
    return isSerif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold;
  }

  // Body role: serif → TimesRoman; unknown / sans → Helvetica.
  // Spec note: body fallback for any *unrecognised* font is TimesRoman.
  if (isSerif) return StandardFonts.TimesRoman;
  return StandardFonts.Helvetica;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly mono: PDFFont;
}

/**
 * Snapshot of the StyleProfile boiled down to numbers/colors/fonts the
 * PDF renderer can use directly. Built once at render start and
 * carried on the {@link LayoutCursor} so every drawing helper reads
 * from the same source of truth.
 */
interface ResolvedStyle {
  readonly margin: { top: number; right: number; bottom: number; left: number };
  readonly contentWidth: number;
  readonly sizes: {
    title: number;
    h1: number;
    h2: number;
    h3: number;
    body: number;
    small: number;
  };
  readonly leading: {
    title: number;
    heading: number;
    body: number;
  };
  readonly sectionGap: number;
  readonly colors: {
    text: ReturnType<typeof rgb>;
    muted: ReturnType<typeof rgb>;
    accent: ReturnType<typeof rgb>;
    rule: ReturnType<typeof rgb>;
  };
}

function resolveStyle(profile: StyleProfile): ResolvedStyle {
  const m = profile.page.margins;
  const text = profileToRgb(profile, "text");
  const muted = profileToRgb(profile, "muted");
  const accent = profileToRgb(profile, "accent");
  const lh = profile.spacing.line_height;
  return {
    margin: { top: m.top, right: m.right, bottom: m.bottom, left: m.left },
    contentWidth: PAGE_WIDTH - m.left - m.right,
    sizes: {
      // Title sits a notch above h1 for hierarchy at the top of the doc.
      title: Math.round(profile.sizes.h1 * 1.15),
      h1: profile.sizes.h1,
      h2: profile.sizes.h2,
      h3: profile.sizes.h3,
      body: profile.sizes.body,
      small: profile.sizes.small,
    },
    leading: {
      title: Math.round(profile.sizes.h1 * 1.15 * lh),
      heading: Math.round(profile.sizes.h2 * lh),
      body: Math.round(profile.sizes.body * lh),
    },
    sectionGap: profile.spacing.paragraph_gap,
    colors: {
      text: rgb(text.r, text.g, text.b),
      muted: rgb(muted.r, muted.g, muted.b),
      accent: rgb(accent.r, accent.g, accent.b),
      // A slightly lighter rule color than `muted`, blended toward white.
      rule: rgb(
        Math.min(1, muted.r + 0.25),
        Math.min(1, muted.g + 0.25),
        Math.min(1, muted.b + 0.25),
      ),
    },
  };
}

interface LayoutCursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  pageIndex: number;
  readonly fonts: Fonts;
  readonly footer: string;
  readonly style: ResolvedStyle;
}

function newPage(cursor: LayoutCursor): void {
  drawFooter(cursor);
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.pageIndex += 1;
  cursor.y = PAGE_HEIGHT - cursor.style.margin.top;
}

function ensureSpace(cursor: LayoutCursor, lineHeight: number): void {
  if (cursor.y - lineHeight < cursor.style.margin.bottom + 30) {
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
  const size = opts.size ?? cursor.style.sizes.body;
  const color = opts.color ?? cursor.style.colors.text;
  const leading = opts.leading ?? cursor.style.leading.body;
  const indent = opts.indent ?? 0;
  const lines = wrapLines(text, font, size, cursor.style.contentWidth - indent);
  for (const line of lines) {
    ensureSpace(cursor, leading);
    cursor.page.drawText(line, {
      x: cursor.style.margin.left + indent,
      y: cursor.y - size,
      font,
      size,
      color,
    });
    cursor.y -= leading;
  }
}

function drawHeading(cursor: LayoutCursor, text: string): void {
  cursor.y -= cursor.style.sectionGap;
  ensureSpace(cursor, cursor.style.leading.heading + 6);
  // Thin rule above heading, for visual separation.
  cursor.page.drawLine({
    start: { x: cursor.style.margin.left, y: cursor.y + 2 },
    end: { x: PAGE_WIDTH - cursor.style.margin.right, y: cursor.y + 2 },
    thickness: 0.5,
    color: cursor.style.colors.rule,
  });
  drawText(cursor, text, {
    font: cursor.fonts.bold,
    size: cursor.style.sizes.h2,
    leading: cursor.style.leading.heading,
  });
}

function drawTitle(cursor: LayoutCursor, text: string): void {
  drawText(cursor, text, {
    font: cursor.fonts.bold,
    size: cursor.style.sizes.title,
    leading: cursor.style.leading.title,
  });
}

function drawMeta(cursor: LayoutCursor, text: string): void {
  drawText(cursor, text, {
    size: META_SIZE,
    color: cursor.style.colors.muted,
    leading: 12,
  });
}

function drawFooter(cursor: LayoutCursor): void {
  const text = cursor.footer;
  cursor.page.drawText(text, {
    x: cursor.style.margin.left,
    y: cursor.style.margin.bottom / 2,
    font: cursor.fonts.regular,
    size: FOOTER_SIZE,
    color: cursor.style.colors.muted,
  });
  const right = `Page ${cursor.pageIndex}`;
  const w = cursor.fonts.regular.widthOfTextAtSize(right, FOOTER_SIZE);
  cursor.page.drawText(right, {
    x: PAGE_WIDTH - cursor.style.margin.right - w,
    y: cursor.style.margin.bottom / 2,
    font: cursor.fonts.regular,
    size: FOOTER_SIZE,
    color: cursor.style.colors.muted,
  });
}

async function newDocument(
  footer: string,
  profile: StyleProfile,
): Promise<LayoutCursor> {
  const doc = await PDFDocument.create();
  doc.setProducer("Glyph");
  doc.setCreator("Glyph");
  const style = resolveStyle(profile);
  // Each font role lands on its closest pdf-lib StandardFont. The
  // exact face the profile names is intentionally LOST for now —
  // Phase D will swap in fontkit + real Google Fonts.
  const regular = await doc.embedFont(
    mapProfileFontToStandard(profile.fonts.body, "body"),
  );
  const bold = await doc.embedFont(
    mapProfileFontToStandard(profile.fonts.heading, "heading"),
  );
  const mono = await doc.embedFont(
    mapProfileFontToStandard(profile.fonts.mono, "mono"),
  );
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return {
    doc,
    page,
    y: PAGE_HEIGHT - style.margin.top,
    pageIndex: 1,
    fonts: { regular, bold, mono },
    footer,
    style,
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

export async function renderGeneric(
  doc: GlyphDocument,
  profile: StyleProfile = GLYPH_MODERN_PROFILE,
): Promise<PDFDocument> {
  const typeLabel = (readString(doc.document_type) ?? "custom").toUpperCase();
  const footer = `Generated with Glyph · ${typeLabel}`;
  const cursor = await newDocument(footer, profile);

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
      cursor.y -= cursor.style.sectionGap;
      continue;
    }

    // Otherwise, render the node and its children
    await renderGenericNode(cursor, k, v, 0);
    cursor.y -= cursor.style.sectionGap;
  }

  return finalize(cursor);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface GeneratePdfOptions {
  readonly document: GlyphDocument;
  readonly xmp: GlyphXmpMetadata;
  /**
   * Visual style profile. Omitted → Glyph Modern (the built-in default
   * that preserves the pre-Phase-B Helvetica look). Pass the document's
   * saved profile to keep exports on-brand.
   */
  readonly styleProfile?: StyleProfile;
}

/** Render the given document and inject the supplied XMP metadata.
 *
 * All schemas now resolve via the DB-backed registry, so the renderer
 * walks the validated payload generically — there are no per-type
 * compile-time layouts anymore. */
export async function generatePdf(
  options: GeneratePdfOptions,
): Promise<Uint8Array> {
  const { document, xmp, styleProfile } = options;
  const profile = styleProfile ?? GLYPH_MODERN_PROFILE;
  const pdfDoc = await renderGeneric(document, profile);
  injectGlyphXmp(pdfDoc, xmp);
  return pdfDoc.save();
}
