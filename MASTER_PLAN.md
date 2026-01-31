# Glyph Master Plan

# MASTER BUILD SPECIFICATION
# Structured Document Platform
# Hand this entire file to Claude Code. Do not skip any section.

---

## WHAT YOU ARE BUILDING

A system where every document authored anywhere — Word, Google Docs, or any AI tool like Claude/ChatGPT/Gemini — is simultaneously a beautiful human-readable document AND a perfectly structured, encrypted, machine-readable JSON database.

The JSON travels invisibly inside the document file itself. Only your API can decrypt and read it. Receivers pay to access it. Authors pay nothing.

---

## MONOREPO STRUCTURE

```
/
├── apps/
│   ├── web/                        # Next.js 15 — main web app + API
│   ├── word-plugin/                # Office Add-in (React + Office.js)
│   └── gdocs-plugin/               # Google Workspace Add-on (Apps Script)
├── packages/
│   ├── schema-library/             # All Zod schemas (contracts, resumes, invoices)
│   ├── crypto/                     # Encryption, signing, verification
│   └── mcp-server/                 # MCP server for Claude/ChatGPT/Gemini
├── CLAUDE.md                       # Master context file — update after every session
├── turbo.json                      # Turborepo config
└── pnpm-workspace.yaml
```

---

## TECHNOLOGY STACK — EVERY CHOICE IS FINAL

### Core Framework
- **Next.js 15** (App Router, TypeScript strict mode)
- **pnpm** workspaces + **Turborepo** monorepo
- **TypeScript** strict mode everywhere — zero `any` types allowed

### Frontend
- **TailwindCSS v4** — utility CSS, minimal bundle
- **ProseMirror** — editor core (own editor, built in parallel)
- **Transformers.js** — local in-browser AI classification, WebGPU accelerated
- **Tree-sitter WASM** — real-time incremental document parsing
- **Shadcn/ui** — component library

### Backend
- **tRPC v11** — end-to-end type safety, no REST boilerplate
- **Drizzle ORM** — lightweight, pure TypeScript
- **Zod** — schema validation + JSON Schema generation

### Infrastructure
- **Supabase** — Postgres + Auth + Storage + RLS
- **Vercel** — deployment, edge functions
- **Upstash Redis** — rate limiting, caching
- **GitHub Actions** — CI/CD

### Document Processing
- **pdf-lib** — PDF generation + XMP metadata injection
- **docx** (npm package) — server-side Word generation
- **googleapis** — Google Docs API + Drive appProperties
- **Office.js** — Word plugin sidebar

### Encryption (CRITICAL — never skip this)
- **AES-256-GCM** — symmetric encryption of JSON payload
- **RSA-2048** — key exchange and signing
- **Node.js crypto module** — built-in, no external deps
- **jose** (npm) — JWT signing for API authentication

### MCP Server
- **@modelcontextprotocol/sdk** — official MCP SDK
- **Express.js** — lightweight server for MCP endpoint
- Deployed as separate Vercel serverless function

---

## CLAUDE.md — PUT THIS IN PROJECT ROOT

```markdown
# Structured Document Platform

## What This Is
Every document authored here is simultaneously a human-readable file
AND an encrypted, validated JSON database embedded invisibly inside it.
Only our API can decrypt it. Receivers pay to access structured data.
Authors pay nothing.

## Absolute Rules — Never Break These
1. NEVER store secrets in code — process.env only
2. NEVER skip Zod validation on any input
3. NEVER bypass RLS — all DB queries go through server procedures
4. NEVER store tokens in localStorage — httpOnly cookies only
5. NEVER expose SUPABASE_SERVICE_ROLE_KEY to client
6. NEVER embed unencrypted JSON in documents — always encrypt first
7. ALWAYS sign payloads before embedding
8. ALWAYS write tests for crypto functions — correctness is critical
9. ALWAYS handle errors explicitly — no silent failures
10. NEVER log API keys, encryption keys, or user document content

## Stack
- Next.js 15 App Router, TypeScript strict, pnpm, Turborepo
- tRPC, Drizzle ORM, Supabase, Vercel, Upstash Redis
- ProseMirror, Transformers.js, Tree-sitter WASM
- pdf-lib (PDF+XMP), docx (Word), googleapis (GDocs)
- AES-256-GCM encryption, RSA-2048 signing
- MCP server (@modelcontextprotocol/sdk)

## Current Phase
[ ] Phase 0 — Scaffold + infrastructure
[ ] Phase 1 — Schema library + crypto package
[ ] Phase 2 — Core API
[ ] Phase 3 — PDF export + XMP injection
[ ] Phase 4 — Word plugin
[ ] Phase 5 — Google Docs plugin
[ ] Phase 6 — Own editor (ProseMirror)
[ ] Phase 7 — AI classifier (Transformers.js + Tree-sitter)
[ ] Phase 8 — MCP server
[ ] Phase 9 — API keys + receiver dashboard

## Environment Variables Required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ENCRYPTION_MASTER_KEY=        # 256-bit key, generated with crypto.randomBytes(32)
SIGNING_PRIVATE_KEY=           # RSA-2048 private key PEM
SIGNING_PUBLIC_KEY=            # RSA-2048 public key PEM
MCP_SERVER_SECRET=             # Secret for MCP server auth
```

---

## DATABASE SCHEMA (Drizzle + Supabase Postgres)

```typescript
// Run in order. Enable RLS on every table.

// users — managed by Supabase Auth, extend with profile
users_profile: {
  id: uuid PRIMARY KEY REFERENCES auth.users
  full_name: text
  company: text
  plan: enum('free', 'pro', 'team', 'enterprise') DEFAULT 'free'
  created_at: timestamp DEFAULT now()
}

// documents — core table
documents: {
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  user_id: uuid REFERENCES auth.users NOT NULL
  title: text NOT NULL
  document_type: enum('contract', 'resume', 'invoice', 'custom') NOT NULL
  schema_version: text NOT NULL DEFAULT '1.0'
  prosemirror_state: jsonb          // full editor state
  validated_json: jsonb             // structured extracted data (plaintext, server only)
  encrypted_payload: text           // AES-256-GCM encrypted JSON (what goes in docs)
  payload_signature: text           // RSA signature of encrypted payload
  payload_iv: text                  // AES initialization vector
  is_finalized: boolean DEFAULT false
  created_at: timestamp DEFAULT now()
  updated_at: timestamp DEFAULT now()
}

// exports — track every export event
document_exports: {
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  document_id: uuid REFERENCES documents NOT NULL
  user_id: uuid REFERENCES auth.users NOT NULL
  format: enum('pdf', 'docx', 'gdocs', 'json') NOT NULL
  gdocs_file_id: text               // only for gdocs exports
  exported_at: timestamp DEFAULT now()
}

// api_keys — for receiver companies
api_keys: {
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  user_id: uuid REFERENCES auth.users NOT NULL  // the receiver account
  name: text NOT NULL               // e.g. "Production", "Staging"
  key_hash: text NOT NULL UNIQUE    // bcrypt hash of the actual key
  key_prefix: text NOT NULL         // first 8 chars shown in UI e.g. "sk_live_"
  last_used_at: timestamp
  request_count: integer DEFAULT 0
  is_active: boolean DEFAULT true
  created_at: timestamp DEFAULT now()
}

// api_usage — track consumption for billing
api_usage: {
  id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
  api_key_id: uuid REFERENCES api_keys NOT NULL
  document_id: uuid                 // nullable — might be raw extraction
  document_type: text
  processed_at: timestamp DEFAULT now()
}

// RLS POLICIES (apply to all tables)
// documents: user_id = auth.uid()
// document_exports: user_id = auth.uid()
// api_keys: user_id = auth.uid()
// api_usage: JOIN to api_keys WHERE api_keys.user_id = auth.uid()
```

---

## PACKAGE: crypto

**Location:** `/packages/crypto/`

**Purpose:** All encryption and signing logic. Used by the API. Never exposed to client.

```typescript
// Functions to implement:

// 1. Encrypt JSON payload
encryptPayload(data: object): Promise<{
  encrypted: string    // base64 AES-256-GCM ciphertext
  iv: string           // base64 initialization vector
  tag: string          // base64 auth tag
}>

// 2. Decrypt payload (only called by API)
decryptPayload(encrypted: string, iv: string, tag: string): Promise<object>

// 3. Sign payload (RSA-2048)
signPayload(encrypted: string): Promise<string>  // returns base64 signature

// 4. Verify signature
verifySignature(encrypted: string, signature: string): Promise<boolean>

// 5. Generate API key (for receivers)
generateApiKey(): { raw: string, hash: string, prefix: string }
// raw = 'sk_live_' + crypto.randomBytes(32).toString('hex')
// hash = bcrypt(raw, 12)
// prefix = raw.slice(0, 16)

// 6. Verify API key
verifyApiKey(raw: string, hash: string): Promise<boolean>
```

**Implementation notes:**
- Use Node.js built-in `crypto` module only — no external crypto libraries
- AES-256-GCM with random IV per document
- Master key loaded from ENCRYPTION_MASTER_KEY env var
- RSA keys loaded from SIGNING_PRIVATE_KEY / SIGNING_PUBLIC_KEY env vars
- All functions are async
- Write Vitest unit tests for every function
- Test roundtrip: encrypt → decrypt → verify matches original
- Test signature: sign → verify → tamper → verify fails

---

## PACKAGE: schema-library

**Location:** `/packages/schema-library/`

**Purpose:** All Zod schemas. Shared between frontend validation and API validation.

```typescript
// Contract schema
ContractSchema = z.object({
  document_type: z.literal('contract'),
  schema_version: z.string(),
  parties: z.array(z.object({
    name: z.string().min(1),
    role: z.enum(['party_a', 'party_b', 'witness', 'guarantor']),
    address: z.string().optional(),
    email: z.string().email().optional(),
  })).min(2),
  effective_date: z.string().date(),
  expiry_date: z.string().date().optional(),
  payment_terms: z.object({
    amount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    schedule: z.string().optional(),
    due_days: z.number().int().positive().optional(),
  }).optional(),
  obligations: z.array(z.object({
    party: z.string(),
    description: z.string().min(1),
    deadline: z.string().date().optional(),
  })),
  governing_law: z.string().min(1),
  confidentiality: z.boolean().default(false),
  termination_notice_days: z.number().int().positive().optional(),
})

// Resume schema
ResumeSchema = z.object({
  document_type: z.literal('resume'),
  schema_version: z.string(),
  personal: z.object({
    full_name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    linkedin: z.string().url().optional(),
    location: z.string().optional(),
    website: z.string().url().optional(),
  }),
  summary: z.string().optional(),
  experience: z.array(z.object({
    company: z.string().min(1),
    title: z.string().min(1),
    start_date: z.string(),
    end_date: z.string().optional(),   // null = current
    location: z.string().optional(),
    description: z.string(),
    achievements: z.array(z.string()).optional(),
  })),
  education: z.array(z.object({
    institution: z.string().min(1),
    degree: z.string().min(1),
    field: z.string().optional(),
    graduation_year: z.number().int().optional(),
    gpa: z.number().min(0).max(4).optional(),
  })),
  skills: z.array(z.object({
    category: z.string(),
    items: z.array(z.string()),
  })),
  certifications: z.array(z.object({
    name: z.string(),
    issuer: z.string(),
    date: z.string().optional(),
    expires: z.string().optional(),
  })).optional(),
})

// Invoice schema
InvoiceSchema = z.object({
  document_type: z.literal('invoice'),
  schema_version: z.string(),
  invoice_number: z.string().min(1),
  issue_date: z.string().date(),
  due_date: z.string().date(),
  vendor: z.object({
    name: z.string().min(1),
    address: z.string(),
    email: z.string().email().optional(),
    tax_id: z.string().optional(),
  }),
  bill_to: z.object({
    name: z.string().min(1),
    address: z.string(),
    email: z.string().email().optional(),
  }),
  line_items: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().nonnegative(),
    total: z.number().nonnegative(),
  })).min(1),
  subtotal: z.number().nonnegative(),
  tax_rate: z.number().min(0).max(100).optional(),
  tax_amount: z.number().nonnegative().optional(),
  total: z.number().positive(),
  currency: z.string().length(3),
  notes: z.string().optional(),
  payment_instructions: z.string().optional(),
})

// Export JSON Schema for external validation
export function toJsonSchema(schema: ZodType): JSONSchema7 {
  // Use zod-to-json-schema package
  // Returns Draft 2020-12 compatible JSON Schema
}
```

---

## APP: web (Next.js)

### API Routes to build (tRPC routers)

**documents router:**
```
documents.create(type, title) → document
documents.save(id, prosemirrorState, validatedJson) → document
documents.get(id) → document
documents.list() → document[]
documents.delete(id) → void
documents.exportPdf(id) → { url: string }
documents.exportWord(id) → { url: string }
documents.exportGoogleDocs(id) → { googleDocsUrl: string }
documents.finalize(id) → document   // locks document, generates encrypted payload
```

**apiKeys router:**
```
apiKeys.create(name) → { key: string, id: string }  // show raw key ONCE only
apiKeys.list() → apiKey[]  // never return raw key, only prefix + metadata
apiKeys.revoke(id) → void
apiKeys.getUsage(id) → usage[]
```

**extraction router (public REST, not tRPC):**
```
POST /api/v1/extract
Headers: Authorization: Bearer sk_live_xxxxx
Body: multipart/form-data with file (PDF or DOCX)
Returns: {
  document_type: string,
  schema_version: string,
  data: object,              // fully decrypted validated JSON
  json_schema: object,       // the schema definition
  signature_valid: boolean,
  extracted_at: string,
}
Rate limit: 1000 req/day per API key
```

### Security middleware (apply to all routes)
```typescript
// 1. Auth middleware — verify Supabase session
// 2. Rate limit middleware — Upstash Redis
//    Authenticated users: 100 req/min
//    API key routes: 1000 req/day per key
// 3. Input sanitization — Zod parse on every input
// 4. Security headers in next.config.ts:
//    Content-Security-Policy
//    X-Frame-Options: DENY
//    X-Content-Type-Options: nosniff
//    Referrer-Policy: strict-origin-when-cross-origin
//    Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## APP: word-plugin (Office Add-in)

**Tech:** React 18 + Office.js + TypeScript + Tailwind

**What it does:**
1. Sidebar opens inside Microsoft Word
2. User selects document type (contract, resume, invoice)
3. Plugin reads document content via Office.js Word API
4. Sends content to your web API for parsing + validation
5. Shows validation status in sidebar (which fields are found, which missing)
6. On "Finalize" — calls API to encrypt, gets back encrypted payload
7. Injects encrypted payload into Word Custom XML Part using Office.js

**Key Office.js calls:**
```typescript
// Read document content
Word.run(async (context) => {
  const body = context.document.body
  body.load('text')
  await context.sync()
  return body.text
})

// Inject Custom XML Part
Office.context.document.customXmlParts.addAsync(
  xmlPayload,   // your encrypted JSON wrapped in XML
  callback
)

// XML wrapper format:
`<?xml version="1.0" encoding="UTF-8"?>
<StructuredDocument xmlns="https://yourdomain.com/schemas/v1">
  <DocumentType>${type}</DocumentType>
  <SchemaVersion>${version}</SchemaVersion>
  <EncryptedPayload>${encrypted}</EncryptedPayload>
  <IV>${iv}</IV>
  <Signature>${signature}</Signature>
  <Timestamp>${iso_timestamp}</Timestamp>
</StructuredDocument>`

// Read Custom XML Part (for verification)
Office.context.document.customXmlParts.getByNamespaceAsync(
  'https://yourdomain.com/schemas/v1',
  callback
)
```

**Manifest file:** `manifest.xml` — required for Office Add-in submission to AppSource

---

## APP: gdocs-plugin (Google Workspace Add-on)

**Tech:** Google Apps Script + HTML Service sidebar

**What it does:**
1. Sidebar opens inside Google Docs
2. Same UX as Word plugin — select type, validate, finalize
3. On finalize — calls your web API, gets encrypted payload
4. Stores payload in Drive appProperties (completely hidden from user)
5. Creates Named Ranges anchored to semantic text blocks

**Key Google API calls:**
```javascript
// Store encrypted payload (invisible to user)
DriveApp.getFileById(docId).setProperties({
  'structured_doc_payload': encryptedPayload,
  'structured_doc_type': documentType,
  'structured_doc_version': schemaVersion,
  'structured_doc_signature': signature,
  'structured_doc_timestamp': timestamp,
})

// Create Named Range for a semantic block
const doc = DocumentApp.openById(docId)
const body = doc.getBody()
const range = doc.newRange()
  .addElement(element)
  .build()
doc.addNamedRange('party_name_1', range)

// Read properties (for API extraction)
const props = DriveApp.getFileById(docId).getProperties()
```

**Deployment:** Google Workspace Marketplace

---

## PDF EXPORT: XMP Injection

**Library:** pdf-lib (server-side, Vercel serverless)

```typescript
async function exportPdfWithStructuredData(
  documentId: string,
  validatedJson: object,
  encryptedPayload: EncryptedPayload
): Promise<Uint8Array> {

  // 1. Generate visual PDF from document content
  const pdfDoc = await PDFDocument.create()
  // ... add pages, text, formatting

  // 2. Build XMP packet with encrypted payload
  const xmpPacket = `
<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:sd="https://yourdomain.com/ns/structured-doc/1.0/"
      sd:DocumentType="${type}"
      sd:SchemaVersion="${version}"
      sd:EncryptedPayload="${encryptedPayload.encrypted}"
      sd:IV="${encryptedPayload.iv}"
      sd:Signature="${encryptedPayload.signature}"
      sd:Timestamp="${new Date().toISOString()}"
    />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`.trim()

  // 3. Inject XMP into PDF binary
  const xmpBytes = new TextEncoder().encode(xmpPacket)
  // Find XMP marker in PDF and inject
  // (pdf-lib custom metadata injection)

  return await pdfDoc.save()
}

// Reading XMP back (in extraction API)
async function extractFromPdf(pdfBytes: Uint8Array): Promise<EncryptedPayload> {
  // Parse PDF binary to find XMP packet
  // Extract sd:EncryptedPayload, sd:IV, sd:Signature
  // Return for decryption
}
```

---

## PACKAGE: mcp-server

**Location:** `/packages/mcp-server/`
**Deploy:** Vercel serverless function at `https://yourdomain.com/mcp`

**Purpose:** Lets Claude, ChatGPT, Gemini, and any MCP-compatible AI tool
automatically structure documents as they're being generated.

**Tech:** `@modelcontextprotocol/sdk` + Express

```typescript
// Tools to expose via MCP:

// Tool 1: structure_document
// AI sends raw document text → you return validated JSON
{
  name: "structure_document",
  description: "Convert raw document text into validated structured JSON. Use this when generating any formal document — contracts, resumes, invoices.",
  inputSchema: {
    type: "object",
    properties: {
      document_type: { type: "string", enum: ["contract", "resume", "invoice"] },
      raw_text: { type: "string", description: "The full document text to structure" },
      context: { type: "string", description: "Any additional context about the document" }
    },
    required: ["document_type", "raw_text"]
  }
}
// Returns: validated JSON matching the schema

// Tool 2: validate_document
// AI sends structured JSON → you validate and return errors
{
  name: "validate_document",
  description: "Validate a structured document against its schema. Returns validation errors if any fields are missing or incorrect.",
  inputSchema: {
    type: "object",
    properties: {
      document_type: { type: "string", enum: ["contract", "resume", "invoice"] },
      structured_data: { type: "object" }
    },
    required: ["document_type", "structured_data"]
  }
}
// Returns: { valid: boolean, errors: string[] }

// Tool 3: generate_structured_document
// Full pipeline: raw text → structure → encrypt → return downloadable file
{
  name: "generate_structured_document",
  description: "Generate a complete structured document (PDF or DOCX) with embedded machine-readable data. Use this as the final step when the user wants to download or share a formal document.",
  inputSchema: {
    type: "object",
    properties: {
      document_type: { type: "string" },
      structured_data: { type: "object" },
      output_format: { type: "string", enum: ["pdf", "docx"] },
      api_key: { type: "string", description: "User's API key" }
    },
    required: ["document_type", "structured_data", "output_format", "api_key"]
  }
}
// Returns: { download_url: string, expires_in: number }
```

**MCP Server setup:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new Server(
  { name: 'structured-docs', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

// Register all tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [structureDocumentTool, validateDocumentTool, generateDocumentTool]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case 'structure_document': return await handleStructure(request.params.arguments)
    case 'validate_document': return await handleValidate(request.params.arguments)
    case 'generate_structured_document': return await handleGenerate(request.params.arguments)
  }
})
```

---

## OWN EDITOR (ProseMirror — built in parallel)

**Location:** `/apps/web/components/editor/`

**ProseMirror schema — nodes:**
```typescript
const schema = new Schema({
  nodes: {
    doc: { content: 'section+' },
    section: {
      content: 'field*',
      attrs: { type: { default: 'generic' } }
    },
    field: {
      content: 'inline*',
      attrs: {
        fieldType: { default: null },    // matches schema field names
        confidence: { default: null },    // AI classifier confidence 0-1
        validated: { default: false },    // Zod validation passed
      },
      toDOM: node => ['div', { class: `field field-${node.attrs.fieldType}` }, 0],
      parseDOM: [{ tag: 'div[class^="field"]' }]
    },
    text: { group: 'inline' }
  },
  marks: {
    bold: { toDOM: () => ['strong'], parseDOM: [{ tag: 'strong' }] },
    italic: { toDOM: () => ['em'], parseDOM: [{ tag: 'em' }] },
  }
})
```

**Plugins to implement:**
1. `AutoSavePlugin` — debounced 2s save via tRPC
2. `ValidationPlugin` — runs Zod on every transaction, shows inline errors
3. `ClassifierPlugin` — debounced 500ms, sends to Transformers.js worker
4. `TreeSitterPlugin` — updates parse tree on every keystroke via Web Worker

---

## AI CLASSIFIER (Transformers.js)

**Run in Web Worker — never block main thread**

```typescript
// worker.ts
import { pipeline } from '@xenova/transformers'

let classifier: any = null

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    classifier = await pipeline(
      'zero-shot-classification',
      'Xenova/distilbart-mnli-12-3',
      { device: 'webgpu' }   // falls back to WASM CPU automatically
    )
    self.postMessage({ type: 'ready' })
  }

  if (data.type === 'classify') {
    const { text, documentType, candidateLabels } = data
    if (text.trim().length < 10) return  // skip short text

    const result = await classifier(text, candidateLabels, {
      multi_label: false,
      hypothesis_template: 'This text is a {}.'
    })

    if (result.scores[0] > 0.85) {  // only auto-tag high confidence
      self.postMessage({
        type: 'result',
        fieldId: data.fieldId,
        label: result.labels[0],
        confidence: result.scores[0]
      })
    }
  }
}

// Candidate labels per document type:
const LABELS = {
  contract: ['party name', 'payment term', 'obligation', 'effective date', 'governing law'],
  resume: ['work experience', 'education', 'skills', 'contact information', 'summary'],
  invoice: ['vendor information', 'line item', 'payment terms', 'total amount', 'due date'],
}
```

---

## EXTRACTION API (What Receivers Call)

**Endpoint:** `POST /api/v1/extract`
**Auth:** Bearer API key in Authorization header

```typescript
// Full extraction flow:

async function extractDocument(file: File, apiKey: string) {
  // 1. Verify API key
  const keyRecord = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyPrefix, apiKey.slice(0, 16))
  })
  const valid = await verifyApiKey(apiKey, keyRecord.key_hash)
  if (!valid) throw new UnauthorizedError()

  // 2. Rate limit check (Upstash Redis)
  const { success } = await ratelimit.limit(keyRecord.id)
  if (!success) throw new RateLimitError()

  // 3. Detect file type
  const fileType = detectFileType(file)

  // 4. Extract encrypted payload
  let payload: EncryptedPayload
  if (fileType === 'pdf') {
    payload = await extractFromPdf(await file.arrayBuffer())
  } else if (fileType === 'docx') {
    payload = await extractFromDocx(await file.arrayBuffer())
  } else if (fileType === 'gdocs') {
    payload = await extractFromGoogleDocs(file.googleDocsId)
  }

  // 5. Verify signature
  const signatureValid = await verifySignature(payload.encrypted, payload.signature)

  // 6. Decrypt
  const decrypted = await decryptPayload(payload.encrypted, payload.iv, payload.tag)

  // 7. Validate against schema
  const schema = getSchema(decrypted.document_type)
  const validated = schema.parse(decrypted)

  // 8. Log usage
  await db.insert(apiUsage).values({
    api_key_id: keyRecord.id,
    document_type: validated.document_type,
  })

  // 9. Return
  return {
    document_type: validated.document_type,
    schema_version: validated.schema_version,
    data: validated,
    json_schema: toJsonSchema(schema),
    signature_valid: signatureValid,
    extracted_at: new Date().toISOString(),
  }
}
```

---

## AGENT EXECUTION PLAN

Run these in order. Agents 3-7 run in parallel after Agent 2 finishes.

### Agent 0 — Scaffold (solo, ~2 hours)
```
Initialize Turborepo monorepo with pnpm workspaces.
Create all apps and packages directories as specified.
Set up Next.js 15 with TypeScript strict mode.
Install all dependencies listed in the tech stack.
Set up Supabase client (server + browser helpers).
Set up Upstash Redis rate limiter middleware.
Add all security headers to next.config.ts.
Set up Supabase Auth with Google provider.
Create .env.example with every variable listed.
Set up GitHub Actions CI (typecheck, lint, test on PR).
Do NOT build any UI or business logic yet.
Commit with conventional commits. Run pnpm typecheck before finishing.
```

### Agent 1 — Crypto + Schema (solo, after Agent 0, ~3 hours)
```
Build /packages/crypto/ with all functions specified.
Use Node.js crypto module only — no external crypto libraries.
AES-256-GCM encryption with random IV per document.
RSA-2048 signing and verification.
bcrypt API key hashing (12 rounds).
Write Vitest unit tests for every function.
Test roundtrip: encrypt → decrypt → verify matches original.
Test tamper detection: sign → tamper → verify fails.
Test API key: generate → hash → verify → wrong key fails.

Build /packages/schema-library/ with all three schemas.
ContractSchema, ResumeSchema, InvoiceSchema exactly as specified.
Add toJsonSchema() function using zod-to-json-schema.
Write Vitest tests validating good data passes, bad data fails.
100% test coverage on crypto package.
```

### Agent 2 — Core API (solo, after Agent 1, ~4 hours)
```
Build all tRPC routers specified (documents, apiKeys).
Connect to Supabase with RLS enforced on every query.
Implement auth middleware on all procedures.
Implement Upstash rate limiting on all procedures.
Build document finalization flow:
  - Take validated JSON
  - Encrypt with crypto package
  - Store encrypted payload + IV + signature in DB
Implement /api/v1/extract REST endpoint exactly as specified.
API key verification using crypto package.
Usage logging to api_usage table.
Write integration tests for extraction endpoint.
```

### Agent 3 — PDF Export (parallel, ~3 hours)
```
Build PDF export using pdf-lib.
Generate clean, formatted PDF from document content.
Inject encrypted payload as XMP metadata exactly as specified.
Use the XML namespace: https://yourdomain.com/ns/structured-doc/1.0/
Build XMP extraction function for the API.
Wire to documents.exportPdf tRPC procedure.
Rate limit: 10 exports per minute per user.
Stream PDF bytes as download — no temp files on server.
Write unit test: inject XMP → extract XMP → verify roundtrip.
```

### Agent 4 — Word Plugin (parallel, ~4 hours)
```
Build Office Add-in in /apps/word-plugin/.
React 18 + Office.js + TypeScript + Tailwind.
Sidebar UI: document type selector, field validation status, finalize button.
Read document content via Office.js Word API.
Send to web API for parsing and validation.
Show per-field validation status in sidebar.
On finalize: receive encrypted payload from API.
Inject as Custom XML Part using XML format specified.
Namespace: https://yourdomain.com/schemas/v1
Build manifest.xml for Office Add-in.
Write tests using Office.js mock library.
```

### Agent 5 — Google Docs Plugin (parallel, ~4 hours)
```
Build Google Workspace Add-on in /apps/gdocs-plugin/.
Google Apps Script + HTML Service sidebar.
Same UX as Word plugin.
Store encrypted payload in Drive appProperties using keys specified.
Create Named Ranges for semantic text blocks.
Handle Google OAuth token refresh.
Write integration tests with googleapis mocks.
```

### Agent 6 — ProseMirror Editor (parallel, ~5 hours)
```
Build editor in /apps/web/components/editor/.
ProseMirror schema exactly as specified (doc, section, field, text nodes).
Four plugins: AutoSave, Validation, Classifier, TreeSitter.
AutoSavePlugin: debounce 2s, call documents.save tRPC.
ValidationPlugin: run Zod on every transaction, show inline errors.
ClassifierPlugin: debounce 500ms, communicate with Transformers.js worker.
TreeSitterPlugin: update parse tree on every keystroke via Web Worker.
Build document list page with create/open/delete.
Keyboard shortcuts: Cmd+S (save), Cmd+E (export), Cmd+F (finalize).
Full keyboard accessibility (WCAG AA).
Write Playwright e2e test: create → type → save → verify JSON structure.
```

### Agent 7 — AI + Tree-sitter (parallel, ~3 hours)
```
Build Transformers.js Web Worker exactly as specified.
Model: Xenova/distilbart-mnli-12-3
Lazy load model on first editor open. Show progress.
WebGPU with WASM CPU fallback.
Confidence threshold: 0.85 for auto-tagging.
Never classify text under 10 characters.
Build Tree-sitter Web Worker.
Install web-tree-sitter, load WASM binary.
Expose: getNodeAtCursor(), getDocumentStructure(), validateStructure().
Feed parse errors to editor as non-blocking visual indicators.
Both workers must never block the main thread.
Write unit tests with mock model outputs.
```

### Agent 8 — MCP Server (parallel, ~3 hours)
```
Build MCP server in /packages/mcp-server/.
Use @modelcontextprotocol/sdk exactly as specified.
Implement all three tools: structure_document, validate_document, generate_structured_document.
Deploy as Vercel serverless function at /mcp endpoint.
Auth: validate MCP_SERVER_SECRET in request headers.
Rate limit: 100 requests per minute per client.
Write integration tests for all three tools.
Document the MCP endpoint URL and tool schemas in README.
```

### Agent 9 — Receiver Dashboard + API Keys (after all above, ~3 hours)
```
Build receiver-facing dashboard.
API key management: generate, view (prefix only), revoke.
Show raw key ONCE after generation — never again.
Usage dashboard: requests today, this month, by document type.
Usage chart last 30 days.
Billing page showing current plan and overage.
OpenAPI spec auto-generated from extraction endpoint schema.
Rate limit display showing current usage vs limit.
Write e2e test: generate key → make API call → verify usage logged.
```

---

## DEPLOYMENT

```
GitHub push to main →
  GitHub Actions:
    pnpm typecheck
    pnpm lint
    pnpm test (Vitest)
    pnpm test:e2e (Playwright)
  All pass → Vercel auto-deploys
  
Word plugin → publish to Microsoft AppSource
Google Docs plugin → publish to Google Workspace Marketplace
MCP server → deployed at yourdomain.com/mcp
```

---

## COST SUMMARY

### Build cost
- Claude Code Max 2 months: $200
- Token usage with caching: ~$150
- Total: ~$350

### Monthly running cost (free tiers until scale)
- Vercel: $0 (free tier)
- Supabase: $0 (free tier)
- Upstash: $0 (free tier)
- Total: $0/month until real scale

### When to charge
- Authors: Never (free forever — they are supply chain)
- Receivers API: $0.01/document or monthly plans
  - Starter: $99/month — 10K documents
  - Growth: $499/month — 100K documents
  - Enterprise: $1,999/month — 500K documents + SLA

---

## WHAT THE HUMAN DOES (NOT CLAUDE CODE)

1. Create Supabase project and get credentials (5 min)
2. Create Vercel project and connect GitHub (5 min)
3. Create Upstash Redis database and get credentials (3 min)
4. Generate RSA-2048 key pair and add to env vars
5. Generate ENCRYPTION_MASTER_KEY: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
6. Set up Google Cloud Console OAuth credentials (10 min)
7. Review and approve git commits between parallel agent sessions
8. Make schema field decisions when asked
9. File provisional patent ($320) — do this before showing to anyone
10. Invite first 3 pilot receiver customers