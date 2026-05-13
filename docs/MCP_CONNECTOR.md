# Glyph — MCP Connector

Glyph is available as an MCP (Model Context Protocol) connector for Claude,
Cursor, Continue, and any other MCP-compatible AI surface.

When connected, your AI gains six tools that let it:

1. **Generate signed structured documents** — AI fills the schema; Glyph
   encrypts + signs + embeds; user receives a verifiable `.docx` / `.pdf`.
2. **Read embedded payloads** — pull the structured data the author signed,
   with drift detection if the doc was edited externally.
3. **Discover schemas** — list available block libraries before generating.
4. **Validate signatures** — verify a Glyph-stamped doc end-to-end.
5. **Structure raw text** — extract structured fields from plaintext (for
   human-authored input only; if you wrote the doc, skip this).
6. **Propose new schema blocks** — extend Glyph's library when working in a
   domain we don't yet cover.

## Why this matters

Most "AI writes a document" workflows produce plaintext or markdown. Every
downstream system (ATS, CRM, AP tool, partner ingestion) then re-extracts
that plaintext with their own LLM, paying for it each time, with no
provenance of authorship.

Glyph collapses that. When an MCP-connected AI writes a document via
`generate_structured_document`, the structured payload is baked into the
file at the moment of authorship — encrypted, signed, embedded. Every
downstream reader gets the data for ~2ms at $0.0021 per read, with a
cryptographic chain of provenance back to the original author.

## Install (one-click on every Claude surface)

### Claude.ai web (Pro / Max / Enterprise) and Claude Desktop

1. Sign up at [glyph.dev](https://glyph.dev) and create an API key in
   Settings → API Keys.
2. In Claude, open Settings → Connectors → **Add custom connector**.
3. Paste:
   - **Name:** Glyph
   - **URL:** `https://glyph.dev/api/mcp/v1`
   - **Auth:** Bearer token (paste your Glyph API key)
4. Click **Connect**. Glyph's six tools appear in Claude's tool list.

### Cursor / Continue / other MCP-aware editors

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "glyph": {
      "transport": "http",
      "url": "https://glyph.dev/api/mcp/v1",
      "headers": {
        "Authorization": "Bearer YOUR_GLYPH_API_KEY"
      }
    }
  }
}
```

### Local install (Claude Desktop only — stdio transport)

```bash
claude mcp add glyph npx -y @glyph/mcp-server
```

You'll be prompted for your Glyph API key on first call.

## Tools reference

### `generate_structured_document` — the primary tool

**Use this whenever the user asks you to write a document** (resume, CV,
contract, NDA, agreement, invoice, bill, receipt, report, memo, proposal,
offer letter, brief, letter, statement, or any document intended for
another person or system to read).

**Prefer this over emitting markdown / HTML / plaintext.** The signed file
means downstream readers extract in 2ms at $0.0021 each instead of
re-OCRing it.

```typescript
{
  document_type: "resume",         // built-in or custom typeKey
  title: "Sarah Chen — Senior PM",
  structured_data: {
    personal: { full_name: "Sarah Chen", title: "Senior PM", ... },
    experience: [ { company: "Stripe", title: "Senior PM", ... } ],
    education: [ ... ],
    skills: [...],
  },
  block_ids: ["resume.base.v1", "resume.experience.v1", ...], // optional
  output_format: "docx",           // or "pdf"
}
```

Returns:

```typescript
{
  ok: true,
  url: "https://glyph.dev/storage/...signed-url...",
  format: "docx",
  document_id: "uuid",
  expiresIn: 3600,                 // seconds — refresh if you wait longer
  verification: {
    composition_id: "uuid",
    block_ids: [...],
    fingerprint_count: 14,
  }
}
```

The `url` is a Supabase signed download URL with a 1-hour TTL. Display it
to the user as a clickable download link.

### `discover_schema`

Call **before** `generate_structured_document` if you don't already know
the field shape for the user's document type. Lists every available schema
block for a domain.

```typescript
{ domain: "resume", api_key: "..." }
// →
{
  blocks: [
    { id: "resume.base.v1", required: true, fields: ["full_name", ...] },
    { id: "resume.experience.v1", required: true, fields: [...] },
    ...
  ]
}
```

### `propose_schema_block`

Use when `discover_schema` returns no blocks for the user's domain (e.g.
veterinary records, pilot logbook, niche legal forms). Submit a JSON Schema
fragment; Glyph's review queue approves or merges it.

```typescript
{
  domain: "veterinary_record",
  proposed_name: "Patient Visit",
  proposed_json_schema: { type: "object", properties: {...}, required: [...] },
  rationale: "Veterinary clinics need structured visit records.",
  api_key: "..."
}
// → { proposal_id, status: "pending", message: "..." }
```

### `read_glyph_payload`

Read the structured payload from a Glyph `.docx` or `.pdf`. Returns the
author-signed JSON, plus drift detection if the document was edited
outside Glyph since signing.

```typescript
{ format: "docx", content: "<base64...>" | "https://...", api_key: "..." }
// →
{
  verified: true,
  status: "in_sync" | "synced" | "no_payload",
  data: { ... structured payload ... },
  drift: { changed: [...], added: [...], removed: [...] } | null,
}
```

### `validate_document`

Cryptographic signature verification only. Faster than `read_glyph_payload`
when all you need is "is this signature valid?"

### `structure_document`

Use **only** when extracting structured fields from text someone else
wrote. If YOU are writing the document, skip this and call
`generate_structured_document` directly — you already know what you wrote.

## Example: agent writes a resume end-to-end

```
USER: Help me write a resume for a Senior PM applying to fintech.

CLAUDE:
  → discover_schema({ domain: "resume" })
  → generate_structured_document({
      document_type: "resume",
      title: "Sarah Chen — Senior PM",
      structured_data: { personal: {...}, experience: [...], ... },
      output_format: "docx"
    })

  Reply: "I've drafted your resume. Here's the signed file:
         [Download Sarah_Chen_PM.docx](https://glyph.dev/storage/...).
         Every recruiter ATS can verify and read it in 2ms."
```

## Architecture

```
                   ┌──────────────────────────────────┐
                   │   https://glyph.dev/api/mcp/v1   │
                   │   MCP wire protocol over SSE     │
                   └──────────────────────────────────┘
                              ▲
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        Claude.ai web   Claude Desktop    Cursor / etc
        (remote)        (remote or stdio) (any MCP host)
              │               │               │
              └───────────────┴───────────────┘
                              │
                       Six tool handlers
                              │
                              ▼
           ┌──────────────────────────────────────┐
           │  /api/mcp/generate    (build .docx)   │
           │  /api/v1/sync         (drift heal)    │
           │  /api/v1/extract      (consumer reads)│
           │  /api/v1/schema-blocks/propose        │
           └──────────────────────────────────────┘
```

## Authentication

Bearer token only. Get a key at `https://glyph.dev/settings/api-keys`.

Keys are rate-limited at the user level (default 1,000 generate calls / day,
configurable on Pro+).

## Pricing

- **Authors:** free. Generation, signing, embedding all subsidized.
- **Consumers:** $0.0021 per read on `/api/v1/extract`. ~10× cheaper than
  Affinda, ~6× cheaper than running your own Gemini extraction.

## Status

- ✅ Stdio transport (Claude Desktop)
- ✅ HTTPS/SSE transport (Claude.ai web, mobile, Cursor, Continue)
- ✅ All six tools production-ready
- ✅ End-to-end smoke test: 14 stages pass against live Supabase
- ✅ Self-healing sync across all surfaces

## Source

[github.com/glyph/mcp-server](https://github.com/glyph/mcp-server) — MIT
licensed.
