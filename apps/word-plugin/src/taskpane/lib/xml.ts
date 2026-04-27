/**
 * Builders for the Glyph Custom XML Part payload.
 *
 * The payload is the only way the plugin communicates structured data to a
 * downstream consumer, so it's intentionally tiny and easy to verify by eye.
 */

export const GLYPH_XML_NAMESPACE = 'https://glyph.dev/schemas/v1';

export interface StructuredPayload {
  readonly documentType: string;
  readonly schemaVersion: string;
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
  readonly signature: string;
  /** ISO-8601 timestamp. Defaults to `new Date().toISOString()`. */
  readonly timestamp?: string;
}

/**
 * Escape text for safe inclusion inside an XML element body.
 *
 * We escape all five XML predefined entities even though `"` and `'` aren't
 * strictly required in element content — it's cheap insurance and keeps the
 * function reusable for attribute values.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildStructuredXml(p: StructuredPayload): string {
  const ts = p.timestamp ?? new Date().toISOString();
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<StructuredDocument xmlns="${GLYPH_XML_NAMESPACE}">\n` +
    `  <DocumentType>${escapeXml(p.documentType)}</DocumentType>\n` +
    `  <SchemaVersion>${escapeXml(p.schemaVersion)}</SchemaVersion>\n` +
    `  <EncryptedPayload>${escapeXml(p.encrypted)}</EncryptedPayload>\n` +
    `  <IV>${escapeXml(p.iv)}</IV>\n` +
    `  <Tag>${escapeXml(p.tag)}</Tag>\n` +
    `  <Signature>${escapeXml(p.signature)}</Signature>\n` +
    `  <Timestamp>${escapeXml(ts)}</Timestamp>\n` +
    `</StructuredDocument>`
  );
}
