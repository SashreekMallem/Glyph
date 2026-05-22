/**
 * Tests for the .docx → StyleProfile extractor.
 *
 * We build tiny synthetic .docx ZIPs in-memory (just a couple of XML
 * members — fflate handles the actual zip) so each case exercises one
 * dimension of the parser:
 *
 *   - Normal/Heading style → fonts + sizes
 *   - <w:pgMar> → page margins
 *   - Word-only font names → allowlist fallback
 *   - Malformed buffer → defaults, no throw
 *
 * These are pure unit tests; no Word required, no fixture files on disk.
 */

import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";

import {
  extractStyleFromDocx,
  mapWordFontToAllowed,
} from "@/lib/style/extract-from-docx";
import { GLYPH_MODERN_PROFILE } from "@glyph/style-profile";

interface BuildOptions {
  readonly stylesXml?: string;
  readonly documentXml?: string;
}

/** Build a buffer that looks enough like a .docx for our parser. */
function buildDocxBuffer(opts: BuildOptions): Buffer {
  const files: Record<string, Uint8Array> = {};
  if (opts.stylesXml !== undefined) {
    files["word/styles.xml"] = strToU8(opts.stylesXml);
  }
  if (opts.documentXml !== undefined) {
    files["word/document.xml"] = strToU8(opts.documentXml);
  }
  // fflate's zipSync wants at least one entry; guarantee one so the
  // "everything missing" test still produces a valid zip we can pass in.
  if (Object.keys(files).length === 0) {
    files["unused.txt"] = strToU8("");
  }
  return Buffer.from(zipSync(files));
}

const STYLES_XML_FULL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/>
      <w:sz w:val="40"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri Light"/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri Light"/>
      <w:sz w:val="26"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const DOCUMENT_XML_WITH_MARGINS = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p/>
    <w:sectPr>
      <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/>
    </w:sectPr>
  </w:body>
</w:document>`;

describe("extractStyleFromDocx", () => {
  it("extracts fonts and sizes from the Normal + Heading styles", async () => {
    const buf = buildDocxBuffer({ stylesXml: STYLES_XML_FULL });
    const profile = await extractStyleFromDocx(buf);

    // Calibri Light is mapped down to Calibri (in the allowlist).
    expect(profile.fonts.heading).toBe("Calibri");
    expect(profile.fonts.body).toBe("Aptos");

    // 22 half-points = 11pt → 15px (round of 14.667 at 1pt = 4/3 px)
    expect(profile.sizes.body).toBe(15);
    // 40 half-points = 20pt → 27px
    expect(profile.sizes.h1).toBe(27);
    // 32 half-points = 16pt → 21px
    expect(profile.sizes.h2).toBe(21);
    // 26 half-points = 13pt → 17px
    expect(profile.sizes.h3).toBe(17);
  });

  it("extracts page margins from word/document.xml", async () => {
    const buf = buildDocxBuffer({
      stylesXml: STYLES_XML_FULL,
      documentXml: DOCUMENT_XML_WITH_MARGINS,
    });
    const profile = await extractStyleFromDocx(buf);

    // 1440 twips ÷ 20 = 72pt (1 inch — matches the Word default)
    expect(profile.page.margins.top).toBe(72);
    expect(profile.page.margins.bottom).toBe(72);
    // 1080 twips ÷ 20 = 54pt
    expect(profile.page.margins.left).toBe(54);
    expect(profile.page.margins.right).toBe(54);
  });

  it("falls back to GLYPH_MODERN_PROFILE when the buffer is not a valid zip", async () => {
    const profile = await extractStyleFromDocx(Buffer.from("not a docx"));
    expect(profile).toEqual(GLYPH_MODERN_PROFILE);
  });

  it("preserves defaults for fields the docx does not specify", async () => {
    // styles.xml only carries a Normal style — no Heading1/2/3, no pgMar.
    const partialStyles = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:rPr>
      <w:rFonts w:ascii="Georgia"/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
</w:styles>`;
    const buf = buildDocxBuffer({ stylesXml: partialStyles });
    const profile = await extractStyleFromDocx(buf);

    // Body font + size pulled from Normal.
    expect(profile.fonts.body).toBe("Georgia");
    // 24 half-points = 12pt = 16px (rounded).
    expect(profile.sizes.body).toBe(16);

    // Heading sizes fall back to the default profile (no Heading1/2/3 in doc).
    expect(profile.sizes.h1).toBe(GLYPH_MODERN_PROFILE.sizes.h1);
    expect(profile.sizes.h2).toBe(GLYPH_MODERN_PROFILE.sizes.h2);
    expect(profile.sizes.h3).toBe(GLYPH_MODERN_PROFILE.sizes.h3);

    // Margins fall back to defaults (no pgMar in document.xml).
    expect(profile.page.margins).toEqual(GLYPH_MODERN_PROFILE.page.margins);

    // Mono font is never set by docx; should still equal the default.
    expect(profile.fonts.mono).toBe(GLYPH_MODERN_PROFILE.fonts.mono);
  });
});

describe("mapWordFontToAllowed", () => {
  it("maps Word-only fonts to allowlist equivalents", () => {
    expect(mapWordFontToAllowed("Calibri Light")).toBe("Calibri");
    expect(mapWordFontToAllowed("Aptos Display")).toBe("Aptos");
    expect(mapWordFontToAllowed("Cambria Math")).toBe("Georgia");
    expect(mapWordFontToAllowed("Times")).toBe("Times New Roman");
    expect(mapWordFontToAllowed("Helvetica Neue")).toBe("Helvetica");
    expect(mapWordFontToAllowed("Consolas")).toBe("JetBrains Mono");
  });

  it("passes through fonts already in the allowlist", () => {
    expect(mapWordFontToAllowed("Georgia")).toBe("Georgia");
    expect(mapWordFontToAllowed("Inter")).toBe("Inter");
  });

  it("returns null for empty input or unknown fonts", () => {
    expect(mapWordFontToAllowed(null)).toBeNull();
    expect(mapWordFontToAllowed("")).toBeNull();
    expect(mapWordFontToAllowed("Some Vendor Font 9000")).toBeNull();
  });
});
