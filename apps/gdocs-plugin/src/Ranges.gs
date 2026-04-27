/**
 * Named-range helpers for the Glyph add-on.
 *
 * After finalization we tag every detected field with a named range whose
 * name follows the pattern `glyph_field_{fieldPath}`. Future edits can
 * re-locate a field by looking up its named range even if the user has
 * inserted text around it.
 */

const GLYPH_RANGE_PREFIX = 'glyph_field_'

/**
 * Delete every existing Glyph-owned named range in the document.
 */
const clearGlyphNamedRanges = (doc) => {
  const ranges = doc.getNamedRanges()
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    if (r.getName().indexOf(GLYPH_RANGE_PREFIX) === 0) {
      r.remove()
    }
  }
}

/**
 * Best-effort: for each field path, find the first paragraph containing
 * a case-insensitive match for the path segment and wrap it in a named
 * range. Heuristic — exact field extraction is done server-side.
 */
const refreshNamedRangesFromText = (doc, fieldPaths) => {
  clearGlyphNamedRanges(doc)
  const body = doc.getBody()
  const paragraphs = body.getParagraphs()

  for (let i = 0; i < fieldPaths.length; i++) {
    const path = fieldPaths[i]
    if (typeof path !== 'string' || path.length === 0) continue

    const needle = path.split('.').pop() || path
    const matched = findParagraphMatching_(paragraphs, needle)
    if (matched === null) continue

    try {
      const builder = doc.newRange()
      builder.addElement(matched)
      doc.addNamedRange(`${GLYPH_RANGE_PREFIX}${path}`, builder.build())
    } catch (_e) {
      // Skip unrangeable paragraphs silently.
    }
  }
}

const findParagraphMatching_ = (paragraphs, needle) => {
  const lower = needle.toLowerCase()
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const text = p.getText()
    if (typeof text === 'string' && text.toLowerCase().indexOf(lower) !== -1) {
      return p
    }
  }
  return null
}
