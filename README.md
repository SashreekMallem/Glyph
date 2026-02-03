# Glyph

Structured Document Platform — every document is simultaneously human-readable
and an encrypted machine-readable JSON database invisibly embedded in the file.

Authors write in Google Docs, Word, the Glyph editor, or via an AI agent over
MCP. On save, Glyph validates the document's structured data against a Zod
schema, encrypts it, signs it, and embeds it in the file. Recipients extract
the exact structured object from the file in a single API call — no OCR, no
prompt tuning, no ambiguity.

## Stack

- **Monorepo** — pnpm workspaces + Turborepo
- **Web** — Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn-style UI
- **API** — tRPC v11, Zod, rate-limiting via Upstash Redis
- **DB** — Supabase Postgres + Drizzle ORM + RLS
- **Auth** — Supabase Auth (email + password)
- **Editor** — ProseMirror with a typed-field plugin
- **Crypto** — AES-256-GCM payloads, RSA-PSS signatures, bcrypt API keys
- **MCP** — standalone server exposing document generation to AI agents

## Quick start

```bash
# 1. Install
pnpm install

# 2. Copy env template and fill in values
cp .env.example .env.local
# (also symlink or copy to apps/web/.env.local)

# 3. Push schema + seed built-in document types
pnpm db:migrate
pnpm db:seed

# 4. Run the dev server
pnpm dev
```

Open http://localhost:3000.

## Environment variables

All vars live in `.env.example`. The ones you must fill in for local dev:

| Var | Where to get it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings (server-only) |
| `DATABASE_URL` | Supabase → Database → Connection string (pooler for prod) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Upstash console |
| `ENCRYPTION_MASTER_KEY` | `openssl rand -hex 32` |
| `SIGNING_PRIVATE_KEY` + `SIGNING_PUBLIC_KEY` | See `.env.example` for generation recipe |
| `MCP_SERVER_SECRET` | `openssl rand -hex 32` |

## Scripts

Run from the repo root:

- `pnpm dev` — start all dev servers (Next.js, MCP)
- `pnpm build` — production build across workspaces
- `pnpm typecheck` — TypeScript across workspaces
- `pnpm lint` — ESLint across workspaces
- `pnpm test` — Vitest across workspaces
- `pnpm db:migrate` — apply Drizzle migrations
- `pnpm db:seed` — seed the built-in document types + default templates (idempotent)
- `pnpm db:studio` — open Drizzle Studio
- `pnpm db:push` — push schema without migration files (dev only)

## Layout

```
apps/
  web/            Next.js app (editor, settings, marketing, API)
packages/
  crypto/         AES-GCM + RSA-PSS + bcrypt helpers
  schema-library/ Zod schemas for built-in document types
  mcp-server/     Model Context Protocol server for AI agents
```

## Architecture notes

- **Document types are DB-driven.** Built-ins (contract / resume / invoice) keep
  compile-time Zod schemas from `@glyph/schema-library`; custom types are stored
  as JSON Schema in `document_types` and compiled to Zod at runtime by
  `packages/schema-library/src/runtime.ts`.
- **Field descriptors are per-template.** The `document_templates` table holds
  the field-path-to-label map used by the ProseMirror editor. Users can clone
  system templates and edit them.
- **RLS is on for every user-owned table.** See `apps/web/drizzle/rls.sql` and
  `apps/web/drizzle/0002_rls_document_registry.sql`.

See `CLAUDE.md` for the full phased build plan and design rationale.
