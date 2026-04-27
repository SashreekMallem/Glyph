/**
 * Extract a Glyph XMP metadata packet from raw PDF bytes.
 *
 * Cheap binary scan for the xpacket delimiters — we don't parse the
 * surrounding PDF. This survives pdf-lib round-trips, Adobe PDF, and
 * anything else that follows the XMP specification.
 */

import {
  XMP_PACKET_BEGIN,
  XMP_PACKET_END,
  parseGlyphXmpPacket,
  type GlyphXmpMetadata,
} from "./xmp";

function indexOfSubarray(
  haystack: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** The `<?xpacket begin=` prefix — the `begin` attribute value can vary. */
const BEGIN_PREFIX = new TextEncoder().encode("<?xpacket begin=");

/**
 * Extract the Glyph XMP metadata from a PDF byte buffer, or null if no
 * Glyph packet is present.
 *
 * We only look for xpacket delimiters — any PDF with a well-formed XMP
 * packet and our namespace matches. Non-Glyph PDFs return null.
 */
export function extractXmp(pdfBytes: Uint8Array): GlyphXmpMetadata | null {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const endNeedle = new TextEncoder().encode(XMP_PACKET_END);

  let cursor = 0;
  while (cursor < pdfBytes.length) {
    const beginIdx = indexOfSubarray(pdfBytes, BEGIN_PREFIX, cursor);
    if (beginIdx < 0) return null;
    const endIdx = indexOfSubarray(pdfBytes, endNeedle, beginIdx);
    if (endIdx < 0) return null;
    const packet = decoder.decode(
      pdfBytes.subarray(beginIdx, endIdx + endNeedle.length),
    );
    const parsed = parseGlyphXmpPacket(packet);
    if (parsed) return parsed;
    cursor = endIdx + endNeedle.length;
  }
  return null;
}

/** Normalised version of {@link XMP_PACKET_BEGIN} for reference. */
export const XMP_BEGIN_FOR_REFERENCE = XMP_PACKET_BEGIN;
