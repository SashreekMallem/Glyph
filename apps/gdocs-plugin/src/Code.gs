/**
 * Glyph Google Docs add-on — Apps Script entry point.
 *
 * Runtime: V8. Sidebar UI lives in sidebar.html. Server-side helpers are
 * exposed to the sidebar via google.script.run.
 *
 * See DriveProps.gs for appProperties chunking, GlyphApi.gs for outbound
 * Glyph API calls, Ranges.gs for named-range bookkeeping.
 */

const USER_PROP_API_KEY = 'glyph_api_key'
const USER_PROP_API_BASE = 'glyph_api_base'
const DEFAULT_API_BASE = 'https://glyph.dev'

const onOpen = () => {
  DocumentApp.getUi()
    .createAddonMenu()
    .addItem('Open Glyph', 'showSidebar')
    .addToUi()
}

const showSidebar = () => {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('Glyph')
    .setWidth(320)
  DocumentApp.getUi().showSidebar(html)
}

/**
 * Homepage card required by the add-ons manifest. Offers a single button
 * that opens the sidebar (the real UI).
 */
const onHomepage = (_e) => {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Glyph'))
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextButton()
          .setText('Open sidebar')
          .setOnClickAction(
            CardService.newAction().setFunctionName('showSidebar'),
          ),
      ),
    )
    .build()
}

const onFileScopeGranted = (_e) => {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Glyph'))
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          'File scope granted. Open the Extensions menu to launch the sidebar.',
        ),
      ),
    )
    .build()
}

// -- Sidebar RPCs -----------------------------------------------------------

/**
 * Return the current document's plaintext. Called by the sidebar before
 * every validate/finalize request.
 */
const getDocumentText = () => {
  const doc = DocumentApp.getActiveDocument()
  return doc.getBody().getText()
}

/**
 * Return the current document's fileId.
 */
const getDocumentId = () => {
  return DocumentApp.getActiveDocument().getId()
}

/**
 * Persist (or clear) the user's Glyph API key. User-scoped, never written
 * to the Drive file.
 */
const setApiKey = (key) => {
  const props = PropertiesService.getUserProperties()
  if (typeof key === 'string' && key.length > 0) {
    props.setProperty(USER_PROP_API_KEY, key)
  } else {
    props.deleteProperty(USER_PROP_API_KEY)
  }
  return { ok: true }
}

const hasApiKey = () => {
  const key = PropertiesService.getUserProperties().getProperty(USER_PROP_API_KEY)
  return key !== null && key.length > 0
}

const setApiBase = (base) => {
  const props = PropertiesService.getUserProperties()
  if (typeof base === 'string' && base.length > 0) {
    props.setProperty(USER_PROP_API_BASE, base)
  } else {
    props.deleteProperty(USER_PROP_API_BASE)
  }
  return { ok: true }
}

const getApiBase = () => {
  const stored = PropertiesService.getUserProperties().getProperty(
    USER_PROP_API_BASE,
  )
  return stored !== null && stored.length > 0 ? stored : DEFAULT_API_BASE
}

/**
 * Run the heuristic validator server-side via the Glyph API.
 * Returns { extracted, errors, valid } or { error } on auth/network failure.
 */
const validateDocument = (documentType) => {
  const text = getDocumentText()
  return glyphFetch_('/api/gdocs/validate', { documentType, text })
}

/**
 * Encrypt + sign the current document, then embed the encrypted payload
 * into Drive appProperties. Creates named ranges for detected fields so
 * future edits can be located.
 */
const finalizeDocument = (documentType) => {
  const doc = DocumentApp.getActiveDocument()
  const text = doc.getBody().getText()
  const googleDocId = doc.getId()

  const result = glyphFetch_('/api/gdocs/finalize', {
    documentType,
    text,
    googleDocId,
  })
  if (result.error) return result

  writeStoredPayload(googleDocId, {
    encrypted: result.encrypted,
    iv: result.iv,
    tag: result.tag,
    signature: result.signature,
    documentType: result.documentType,
    schemaVersion: result.schemaVersion,
  })

  // Named ranges for every top-level scalar field in the extracted payload.
  try {
    refreshNamedRangesFromText(doc, Object.keys(result).filter((k) => k !== 'encrypted' && k !== 'iv' && k !== 'tag' && k !== 'signature'))
  } catch (_e) {
    // Named ranges are best-effort.
  }

  return { ok: true, finalized: true }
}

/**
 * Read the finalized payload back from Drive appProperties, reassembling
 * chunks. Returns null if the file has never been finalized.
 */
const getStoredPayload = () => {
  const fileId = getDocumentId()
  return readStoredPayload(fileId)
}
