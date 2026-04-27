/**
 * Inject a Glyph XMP metadata packet into a pdf-lib PDFDocument.
 *
 * The spec: PDF 1.4+ allows a document-level XMP metadata stream attached
 * via the document catalog's `/Metadata` entry. The stream must have
 * `/Type /Metadata` and `/Subtype /XML` with raw (unfiltered) UTF-8
 * bytes. See PDF 32000-1:2008 §14.3.2 and Adobe XMP Part 3.
 */

import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

import { buildGlyphXmpPacket, type GlyphXmpMetadata } from "./xmp";

/**
 * Attach (or replace) a Glyph XMP metadata stream on the given document.
 * Returns the same document for chaining.
 */
export function injectGlyphXmp(
  pdfDoc: PDFDocument,
  meta: GlyphXmpMetadata,
): PDFDocument {
  const packet = buildGlyphXmpPacket(meta);
  const bytes = new TextEncoder().encode(packet);

  const context = pdfDoc.context;
  // Raw stream — we must not flate-compress XMP; readers scan the bytes.
  const dict = context.obj({
    Type: "Metadata",
    Subtype: "XML",
    Length: bytes.length,
  });
  const stream = PDFRawStream.of(dict, bytes);
  const ref = context.register(stream);

  pdfDoc.catalog.set(PDFName.of("Metadata"), ref);
  return pdfDoc;
}
