/**
 * Drive appProperties read/write with 124-char chunking.
 *
 * Google Drive's v3 appProperties have a documented 124-character limit
 * per *value* (and a 30-key soft cap). Encrypted Glyph payloads routinely
 * exceed this, so we chunk by splitting the encrypted base64 string into
 * 120-char slices (leaving a few chars of headroom) and store them as
 * glyph_payload_0, glyph_payload_1, ..., plus glyph_payload_count.
 *
 * The chunking logic is mirrored in test/pure/chunking.ts and tested
 * there. KEEP THE TWO IN SYNC.
 */

const PROPS = {
  payload: 'glyph_payload',
  payloadCount: 'glyph_payload_count',
  iv: 'glyph_iv',
  tag: 'glyph_tag',
  signature: 'glyph_signature',
  documentType: 'glyph_document_type',
  schemaVersion: 'glyph_schema_version',
  timestamp: 'glyph_timestamp',
}

const CHUNK_SIZE = 120

/**
 * Split a string into CHUNK_SIZE-char pieces. Empty string yields a
 * single empty chunk so the round-trip is total. See test/pure/chunking.ts.
 */
const chunkString = (value, size) => {
  if (typeof value !== 'string') return ['']
  if (value.length === 0) return ['']
  const chunks = []
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.substring(i, i + size))
  }
  return chunks
}

const reassembleChunks = (chunks) => {
  if (!Array.isArray(chunks)) return ''
  return chunks.join('')
}

/**
 * Write the encrypted payload (chunked) + metadata to Drive appProperties.
 * Requires the advanced Drive service to be enabled (see appsscript.json).
 */
const writeStoredPayload = (fileId, payload) => {
  const chunks = chunkString(payload.encrypted, CHUNK_SIZE)
  const appProperties = {}
  appProperties[PROPS.payloadCount] = String(chunks.length)
  for (let i = 0; i < chunks.length; i++) {
    appProperties[`${PROPS.payload}_${i}`] = chunks[i]
  }
  appProperties[PROPS.iv] = payload.iv
  appProperties[PROPS.tag] = payload.tag
  appProperties[PROPS.signature] = payload.signature
  appProperties[PROPS.documentType] = payload.documentType
  appProperties[PROPS.schemaVersion] = payload.schemaVersion
  appProperties[PROPS.timestamp] = new Date().toISOString()

  // Clear old unchunked key if present (migration safety).
  appProperties[PROPS.payload] = null

  Drive.Files.update({ appProperties: appProperties }, fileId)
}

/**
 * Read the encrypted payload back, reassembling chunks. Returns null if
 * the file has never been finalized by Glyph.
 */
const readStoredPayload = (fileId) => {
  const file = Drive.Files.get(fileId, { fields: 'appProperties' })
  const props = file && file.appProperties ? file.appProperties : null
  if (props === null) return null

  const countRaw = props[PROPS.payloadCount]
  if (countRaw === undefined) {
    // Legacy single-key form, unlikely but handled.
    const single = props[PROPS.payload]
    if (single === undefined) return null
    return buildPayload_(single, props)
  }

  const count = parseInt(countRaw, 10)
  if (!Number.isFinite(count) || count < 0) return null

  const chunks = []
  for (let i = 0; i < count; i++) {
    const piece = props[`${PROPS.payload}_${i}`]
    chunks.push(typeof piece === 'string' ? piece : '')
  }
  const encrypted = reassembleChunks(chunks)
  return buildPayload_(encrypted, props)
}

const buildPayload_ = (encrypted, props) => {
  return {
    encrypted: encrypted,
    iv: props[PROPS.iv] || '',
    tag: props[PROPS.tag] || '',
    signature: props[PROPS.signature] || '',
    documentType: props[PROPS.documentType] || '',
    schemaVersion: props[PROPS.schemaVersion] || '',
    timestamp: props[PROPS.timestamp] || '',
  }
}
