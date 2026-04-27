/**
 * TypeScript mirror of the chunking logic in src/DriveProps.gs.
 *
 * Google Drive v3 appProperties values are capped at 124 characters each,
 * so encrypted Glyph payloads are split into CHUNK_SIZE-char pieces
 * (with a small margin) and reassembled on read.
 *
 * KEEP IN SYNC with src/DriveProps.gs — any change to CHUNK_SIZE or the
 * empty-string handling here must be mirrored there.
 */

export const CHUNK_SIZE = 120;

export function chunkString(value: string, size: number = CHUNK_SIZE): readonly string[] {
  if (typeof value !== "string") return [""];
  if (value.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.substring(i, i + size));
  }
  return chunks;
}

export function reassembleChunks(chunks: readonly string[]): string {
  if (!Array.isArray(chunks)) return "";
  return chunks.join("");
}
