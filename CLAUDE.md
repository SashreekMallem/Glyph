# CLAUDE.md — Glyph

## Product

Glyph is the Structured Document Platform: every document authored anywhere (Word, Google Docs, or via MCP in Claude/ChatGPT/Gemini) is simultaneously human-readable AND an encrypted machine-readable JSON database invisibly embedded in the file. Only Glyph's API can decrypt. Authors pay nothing; receivers pay per extraction.

Brand identity: **Glyph** — premium, modern, minimalist (thin type, monochrome, whitespace).

## Stack (final)

- Next.js 15 (App Router), TypeScript strict, zero `any`
- pnpm workspaces + Turborepo
- TailwindCSS v4
- tRPC v11
- Drizzle ORM (Postgres)
- Zod
- Supabase (Postgres + Auth + Storage + RLS)
- Upstash Redis (rate limiting)
- Shadcn/ui
- Vercel deploy target

## Rules

1. TypeScript strict mode on, `noUncheckedIndexedAccess: true`, zero `any`.
2. Every file must typecheck (`pnpm typecheck`) and lint (`pnpm lint`) before merging.
3. No secrets in code. Everything via `process.env`.
4. Use `pnpm` only. Never `npm` or `yarn`.
5. Security headers, CSP, and auth middleware are non-negotiable.
6. Keep business logic out of scaffolding; each agent owns their package.

## Environment variables

See `.env.example` at repo root for the full list. Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ENCRYPTION_MASTER_KEY`
- `SIGNING_PRIVATE_KEY`
- `SIGNING_PUBLIC_KEY`
- `MCP_SERVER_SECRET`

## Phase checklist

- [x] Phase 0 — Scaffold + infrastructure
- [x] Phase 1 — Schema library + crypto package
- [x] Phase 2 — Core API (DB schema + RLS + tRPC routers + extract endpoint)
- [x] Phase 3 — PDF export + XMP embed/extract pipeline
- [ ] Phase 4 — Document ingest + embed pipeline
- [ ] Phase 5 — Extraction API + billing
- [x] Phase 4 — Word plugin
- [x] Phase 5 — Google Docs plugin
- [x] Phase 7 — AI classifier (Transformers.js + Tree-sitter)
- [ ] Phase 8 — MCP server (`@glyph/mcp-server`)
- [ ] Phase 9 — Admin + analytics
- [ ] Phase 10 — Launch hardening

## Workspace layout

```
apps/
  web/              Next.js 15 app (the platform)
  word-plugin/      Office.js task pane (later)
  gdocs-plugin/     Google Apps Script add-on (later)
packages/
  crypto/           Encryption, signing, key derivation
  schema-library/   Document schemas + validators
  mcp-server/       MCP adapter for LLM clients
```

## Scripts

- `pnpm dev` — run every app's dev task
- `pnpm build` — build all
- `pnpm typecheck` — strict tsc across the graph
- `pnpm lint` — eslint
- `pnpm test` — vitest
- `pnpm format` — prettier
