/**
 * Glyph XMP packet construction and parsing.
 *
 * The packet carries the AES-GCM ciphertext + IV + tag and the RSA-PSS
 * signature for the document payload. Nothing in plaintext — the whole
 * point of embedding this is that the PDF is self-contained, but only
 * Glyph (and whoever holds the master key) can read it.
 */

export const GLYPH_XMP_NAMESPACE =
  "https://glyph.dev/ns/structured-doc/1.0/";

export const XMP_PACKET_BEGIN = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>';
export const XMP_PACKET_END = '<?xpacket end="w"?>';

export interface GlyphXmpMetadata {
  readonly documentType: string;
  readonly schemaVersion: string;
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
  readonly signature: string;
  readonly timestamp: string;
  /**
   * Optional pointer into `schema_compositions` — the resolved adaptive
   * schema this document was authored against. Older documents predate
   * the composition resolver and omit this field.
   */
  readonly compositionId?: string | null;
  /**
   * Optional comma-joined list of block ids. Always sorted (the
   * fingerprint depends on order). Used by readers that want to revive
   * the same schema without round-tripping through `compositionId`.
   */
  readonly blockIds?: readonly string[] | null;
}

/**
 * Escape a string for safe inclusion in a double-quoted XML attribute
 * value. Five predefined entities only; no other transformation.
 */
export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Build the full XMP packet for a set of Glyph metadata fields. */
export function buildGlyphXmpPacket(meta: GlyphXmpMetadata): string {
  const attrs: [string, string][] = [
    ["glyph:DocumentType", meta.documentType],
    ["glyph:SchemaVersion", meta.schemaVersion],
    ["glyph:EncryptedPayload", meta.encrypted],
    ["glyph:IV", meta.iv],
    ["glyph:Tag", meta.tag],
    ["glyph:Signature", meta.signature],
    ["glyph:Timestamp", meta.timestamp],
  ];
  if (meta.compositionId !== undefined && meta.compositionId !== null) {
    attrs.push(["glyph:CompositionId", meta.compositionId]);
  }
  if (
    meta.blockIds !== undefined &&
    meta.blockIds !== null &&
    meta.blockIds.length > 0
  ) {
    attrs.push(["glyph:BlockIds", meta.blockIds.join(",")]);
  }
  const attrLines = attrs
    .map(([k, v]) => `      ${k}="${escapeXmlAttr(v)}"`)
    .join("\n");
  return (
    `${XMP_PACKET_BEGIN}\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `    <rdf:Description rdf:about=""\n` +
    `      xmlns:glyph="${GLYPH_XMP_NAMESPACE}"\n` +
    `${attrLines}\n` +
    `    />\n` +
    `  </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `${XMP_PACKET_END}`
  );
}

/** Reverse of {@link escapeXmlAttr} for the five predefined entities. */
export function unescapeXmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function readGlyphAttr(xml: string, local: string): string | null {
  // Matches: glyph:Name="value" with value potentially containing escaped quotes.
  // The attribute value is delimited by the first unescaped double quote.
  const re = new RegExp(`glyph:${local}\\s*=\\s*"([^"]*)"`);
  const m = re.exec(xml);
  if (!m || m[1] === undefined) return null;
  return unescapeXmlAttr(m[1]);
}

/**
 * Parse a Glyph XMP packet. Returns null if any of the required
 * attributes are missing or the Glyph namespace is not declared.
 */
export function parseGlyphXmpPacket(xml: string): GlyphXmpMetadata | null {
  if (!xml.includes(GLYPH_XMP_NAMESPACE)) return null;
  const documentType = readGlyphAttr(xml, "DocumentType");
  const schemaVersion = readGlyphAttr(xml, "SchemaVersion");
  const encrypted = readGlyphAttr(xml, "EncryptedPayload");
  const iv = readGlyphAttr(xml, "IV");
  const tag = readGlyphAttr(xml, "Tag");
  const signature = readGlyphAttr(xml, "Signature");
  const timestamp = readGlyphAttr(xml, "Timestamp");
  if (
    documentType === null ||
    schemaVersion === null ||
    encrypted === null ||
    iv === null ||
    tag === null ||
    signature === null ||
    timestamp === null
  ) {
    return null;
  }
  const compositionId = readGlyphAttr(xml, "CompositionId");
  const blockIdsRaw = readGlyphAttr(xml, "BlockIds");
  const blockIds =
    blockIdsRaw === null || blockIdsRaw.length === 0
      ? null
      : blockIdsRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    documentType,
    schemaVersion,
    encrypted,
    iv,
    tag,
    signature,
    timestamp,
    compositionId,
    blockIds,
  };
}
