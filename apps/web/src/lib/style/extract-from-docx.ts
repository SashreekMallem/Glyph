/**
 * Extract a `StyleProfile` from a `.docx` file buffer.
 *
 * A .docx is a ZIP — `word/styles.xml` carries Word's named-style table
 * (Normal, Heading 1/2/3, etc.) and `word/document.xml` carries the
 * `<w:pgMar>` block on the section properties of the body. We unzip with
 * `fflate` (already a dep), pull the two relevant XML members, and run
 * a few small regex walks to extract:
 *
 *   - Normal style → body font family + size
 *   - Heading1/2/3 styles → heading family + size (one family wins —
 *     Word lets every level have its own family, but in practice
 *     authors keep them consistent, so we take Heading1's font and
 *     Heading1/2/3 sizes individually).
 *   - sectPr/pgMar → page margins in points.
 *
 * Anything we can't recover falls back to `GLYPH_MODERN_PROFILE`. Font
 * families that aren't in our allowlist are mapped to the closest
 * equivalent via `mapWordFontToAllowed` so the resulting profile is
 * always renderable in the editor and exporters.
 *
 * The function is intentionally regex-driven instead of pulling in a
 * full OOXML parser — Word's styles.xml is well-formed, predictable,
 * and the failure mode (regex misses → default) is safe.
 */

import { unzipSync, strFromU8 } from "fflate";

import {
  GLYPH_MODERN_PROFILE,
  StyleProfileSchema,
  isAllowedFont,
  mergeProfiles,
  type StyleProfile,
} from "@glyph/style-profile";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Map a Word/OOXML font family to a font in our allowlist.
 *
 * Word ships with several fonts that we don't enumerate (`Calibri Light`,
 * `Cambria`, `Cambria Math`, `Times`, …). When we see one, we collapse
 * it to the closest visually-similar member of `ALL_ALLOWED_FONTS`.
 *
 * `null` is returned when the input is empty — caller falls back to the
 * default profile in that case.
 */
export function mapWordFontToAllowed(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const name = raw.trim();
  if (name.length === 0) return null;

  // Direct hit — keep as-is.
  if (isAllowedFont(name)) return name;

  // Common Word fonts → closest allowlist equivalent.
  const lowered = name.toLowerCase();
  // "Calibri Light", "Calibri (Body)" → Calibri
  if (lowered.startsWith("calibri")) return "Calibri";
  // "Aptos Display", "Aptos Narrow" → Aptos
  if (lowered.startsWith("aptos")) return "Aptos";
  // "Cambria", "Cambria Math" → Georgia (closest serif)
  if (lowered.startsWith("cambria")) return "Georgia";
  // "Times" / "Times New Roman variants" → Times New Roman
  if (lowered.startsWith("times")) return "Times New Roman";
  // "Consolas", "Lucida Console" → JetBrains Mono (mono fallback)
  if (lowered.startsWith("consolas") || lowered.includes("console")) {
    return "JetBrains Mono";
  }
  // "Arial Narrow", "Arial Black" → Arial
  if (lowered.startsWith("arial")) return "Arial";
  // "Helvetica Neue" → Helvetica
  if (lowered.startsWith("helvetica")) return "Helvetica";
  // Anything else: don't guess — fall back to the default profile font.
  return null;
}

/**
 * Run a regex against the named-style block for `styleId`. Word emits
 *
 *   <w:style w:type="paragraph" w:styleId="Normal">
 *     <w:rPr>
 *       <w:rFonts w:ascii="Aptos" .../>
 *       <w:sz w:val="22"/>
 *     </w:rPr>
 *   </w:style>
 *
 * We grab the `<w:style ...styleId="X">…</w:style>` block first, then
 * pull `w:ascii` and `w:sz` from inside that scope so values bleed
 * across styles only if the block boundary is malformed.
 */
function findStyleBlock(stylesXml: string, styleId: string): string | null {
  // Anchor on the opening tag's styleId attribute — Word never reuses
  // styleIds within a single styles.xml so this is safe.
  const open = new RegExp(
    `<w:style\\b[^>]*w:styleId\\s*=\\s*"${styleId}"[^>]*>`,
    "i",
  );
  const openMatch = open.exec(stylesXml);
  if (openMatch === null) return null;
  const startIdx = openMatch.index;
  // Find the matching </w:style>. Word doesn't nest style elements so a
  // simple search from the open is sufficient.
  const closeIdx = stylesXml.indexOf("</w:style>", startIdx);
  if (closeIdx < 0) return null;
  return stylesXml.slice(startIdx, closeIdx + "</w:style>".length);
}

const FONT_RE = /<w:rFonts\b[^>]*\bw:ascii\s*=\s*"([^"]+)"/i;
const SIZE_RE = /<w:sz\b[^>]*\bw:val\s*=\s*"([^"]+)"/i;

function extractFontFromBlock(block: string | null): string | null {
  if (block === null) return null;
  const m = FONT_RE.exec(block);
  return m && m[1] ? m[1] : null;
}

function extractHalfPointSizeFromBlock(block: string | null): number | null {
  if (block === null) return null;
  const m = SIZE_RE.exec(block);
  if (!m || !m[1]) return null;
  const halfPoints = Number.parseInt(m[1], 10);
  if (!Number.isFinite(halfPoints) || halfPoints <= 0) return null;
  // Word stores font sizes in half-points; UI in points; StyleProfile
  // sizes are CSS pixels. Convert pt → px using the 1pt = 1.333px web
  // convention so an 11pt Word body lines up with a 14px web body
  // (which is what the Glyph Modern default uses).
  const points = halfPoints / 2;
  return Math.round(points * (4 / 3));
}

const PG_MAR_RE =
  /<w:pgMar\b([^>]*)\/?>/i;

interface PageMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Parse the `<w:pgMar>` element. Margins are stored in twentieths of a
 * point (twips), so divide by 20 to land in points.
 */
function extractPageMargins(documentXml: string): PageMargins | null {
  const m = PG_MAR_RE.exec(documentXml);
  if (m === null) return null;
  const attrs = m[1] ?? "";
  const grab = (name: string): number | undefined => {
    const re = new RegExp(`\\bw:${name}\\s*=\\s*"([0-9-]+)"`, "i");
    const hit = re.exec(attrs);
    if (!hit || !hit[1]) return undefined;
    const n = Number.parseInt(hit[1], 10);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.round(n / 20);
  };
  const result: PageMargins = {};
  const top = grab("top");
  const right = grab("right");
  const bottom = grab("bottom");
  const left = grab("left");
  if (top !== undefined) result.top = top;
  if (right !== undefined) result.right = right;
  if (bottom !== undefined) result.bottom = bottom;
  if (left !== undefined) result.left = left;
  if (
    result.top === undefined &&
    result.right === undefined &&
    result.bottom === undefined &&
    result.left === undefined
  ) {
    return null;
  }
  return result;
}

/**
 * Walk the .docx ZIP and pull the two XML members we care about.
 * Returns `null` for either if the .docx is malformed or missing the
 * member — in either case `extractStyleFromDocx` falls back to defaults.
 */
function readDocxXml(buffer: Buffer): {
  stylesXml: string | null;
  documentXml: string | null;
} {
  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch {
    return { stylesXml: null, documentXml: null };
  }

  const stylesEntry = entries["word/styles.xml"];
  const documentEntry = entries["word/document.xml"];

  return {
    stylesXml: stylesEntry ? strFromU8(stylesEntry) : null,
    documentXml: documentEntry ? strFromU8(documentEntry) : null,
  };
}

/**
 * Public entry point. Reads style hints from a Word .docx file and
 * returns a fully-resolved `StyleProfile`. Failures at any layer
 * collapse to `GLYPH_MODERN_PROFILE` so the caller never has to handle
 * partial state.
 */
export async function extractStyleFromDocx(
  buffer: Buffer,
): Promise<StyleProfile> {
  const { stylesXml, documentXml } = readDocxXml(buffer);

  const partial: DeepPartial<StyleProfile> = {};

  if (stylesXml !== null) {
    // Word's styles.xml uses styleId="Normal" / "Heading1" / "Heading2"
    // / "Heading3" by convention (the localized display name is in a
    // separate `<w:name>` child — styleId is the stable handle).
    const normalBlock = findStyleBlock(stylesXml, "Normal");
    const h1Block = findStyleBlock(stylesXml, "Heading1");
    const h2Block = findStyleBlock(stylesXml, "Heading2");
    const h3Block = findStyleBlock(stylesXml, "Heading3");

    const normalFontRaw = extractFontFromBlock(normalBlock);
    const headingFontRaw = extractFontFromBlock(h1Block);
    const normalSizePx = extractHalfPointSizeFromBlock(normalBlock);
    const h1SizePx = extractHalfPointSizeFromBlock(h1Block);
    const h2SizePx = extractHalfPointSizeFromBlock(h2Block);
    const h3SizePx = extractHalfPointSizeFromBlock(h3Block);

    const normalFont = mapWordFontToAllowed(normalFontRaw);
    const headingFont =
      mapWordFontToAllowed(headingFontRaw) ?? normalFont;

    if (normalFont !== null || headingFont !== null) {
      partial.fonts = {};
      if (headingFont !== null) partial.fonts.heading = headingFont;
      if (normalFont !== null) partial.fonts.body = normalFont;
    }

    if (
      normalSizePx !== null ||
      h1SizePx !== null ||
      h2SizePx !== null ||
      h3SizePx !== null
    ) {
      partial.sizes = {};
      if (h1SizePx !== null) partial.sizes.h1 = h1SizePx;
      if (h2SizePx !== null) partial.sizes.h2 = h2SizePx;
      if (h3SizePx !== null) partial.sizes.h3 = h3SizePx;
      if (normalSizePx !== null) partial.sizes.body = normalSizePx;
    }
  }

  if (documentXml !== null) {
    const margins = extractPageMargins(documentXml);
    if (margins !== null) {
      partial.page = { margins: { ...margins } };
    }
  }

  const merged = mergeProfiles(GLYPH_MODERN_PROFILE, partial);
  const parsed = StyleProfileSchema.safeParse(merged);
  if (!parsed.success) {
    // Defense-in-depth: a malformed extraction must never crash callers.
    return GLYPH_MODERN_PROFILE;
  }
  return parsed.data;
}
