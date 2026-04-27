export {
  generatePdf,
  renderContract,
  renderResume,
  renderInvoice,
  type GeneratePdfOptions,
} from "./generate";
export { injectGlyphXmp } from "./inject";
export { extractXmp } from "./extract";
export {
  buildGlyphXmpPacket,
  parseGlyphXmpPacket,
  escapeXmlAttr,
  unescapeXmlAttr,
  GLYPH_XMP_NAMESPACE,
  XMP_PACKET_BEGIN,
  XMP_PACKET_END,
  type GlyphXmpMetadata,
} from "./xmp";
