/**
 * Glyph API client for the Google Docs add-on.
 *
 * Apps Script runs in a sandboxed Node-like environment — UrlFetchApp is
 * the only outbound HTTP. Cookies are not available, so we use Bearer
 * API keys stored in PropertiesService.getUserProperties() (user-scoped,
 * never written to the Drive file).
 */

/**
 * Internal: POST JSON to a Glyph endpoint. Returns the parsed response
 * body, or { error: { code, message } } on failure.
 */
const glyphFetch_ = (path, body) => {
  const apiKey = PropertiesService.getUserProperties().getProperty(
    USER_PROP_API_KEY,
  )
  if (apiKey === null || apiKey.length === 0) {
    return {
      error: {
        code: 'not_connected',
        message: 'Connect to Glyph first (paste your API key in the sidebar).',
      },
    }
  }

  const base = getApiBase()
  const url = `${base}${path}`

  let response
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      headers: { Authorization: `Bearer ${apiKey}` },
      muteHttpExceptions: true,
    })
  } catch (e) {
    return {
      error: {
        code: 'network_error',
        message: e && e.message ? e.message : 'Network error.',
      },
    }
  }

  const status = response.getResponseCode()
  const text = response.getContentText()

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (_e) {
    return {
      error: {
        code: 'bad_response',
        message: `Non-JSON response (${status}).`,
      },
    }
  }

  if (status < 200 || status >= 300) {
    const errObj =
      parsed && parsed.error
        ? parsed.error
        : { code: 'http_error', message: `HTTP ${status}` }
    return { error: errObj }
  }

  return parsed
}
