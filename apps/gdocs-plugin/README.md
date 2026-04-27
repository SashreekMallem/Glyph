# @glyph/gdocs-plugin

Google Workspace add-on for Glyph. Runs inside Google Docs as an
Apps Script project (HTML Service sidebar).

## Architecture

- `src/Code.gs` — Apps Script entry point: `onOpen`, `showSidebar`, `onHomepage`, sidebar RPCs (`validateDocument`, `finalizeDocument`, `getStoredPayload`, `setApiKey`, ...).
- `src/GlyphApi.gs` — `glyphFetch_()` wrapper around `UrlFetchApp` with Bearer API key auth.
- `src/DriveProps.gs` — Drive appProperties R/W with 120-char chunking (Drive caps values at 124 chars).
- `src/Ranges.gs` — Named-range helpers keyed by `glyph_field_*`.
- `src/sidebar.html` — Self-contained sidebar UI (inline CSS + vanilla JS). No bundler.
- `src/appsscript.json` — Manifest. Advanced Drive service (`Drive v3`) is enabled here; the user must also enable it in their Apps Script project settings the first time they run the add-on.
- `test/pure/chunking.ts` — TypeScript mirror of the chunking logic in `DriveProps.gs`. Kept in sync manually — change both together.
- `test/chunking.test.ts` — Vitest suite for chunking.

## Why two styles (sidebar + onHomepage)?

Google's Workspace Marketplace requires a Card-based `homepageTrigger`
for distribution. The real UX is the menu-driven sidebar (more pixels,
richer HTML). `onHomepage` just renders a button that calls
`showSidebar`, satisfying the store requirements without duplicating UI.

## Auth

Apps Script `UrlFetchApp` cannot carry browser cookies. We authenticate
to the Glyph API with the user's personal API key (`sk_live_*`), stored
in `PropertiesService.getUserProperties()` — user-scoped and **never**
written to the Drive file (user-visible via `appProperties`).

## Install (developer)

```
npm i -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json
# fill in scriptId (from https://script.new or an existing project)
clasp push
```

Then open any Google Doc → Extensions → Glyph → Open Glyph.

## Test / typecheck

```
pnpm -F @glyph/gdocs-plugin test
pnpm -F @glyph/gdocs-plugin typecheck
```

Apps Script `.gs` files are not type-checked by Node tooling — only the
pure helpers mirrored in `test/pure/` are. If you edit the chunking
logic in `DriveProps.gs`, also edit `test/pure/chunking.ts` and extend
`test/chunking.test.ts`.
