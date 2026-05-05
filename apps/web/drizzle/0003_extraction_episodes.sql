-- Bi-temporal extraction tracking.
--
-- APPLICATION NOTE: This migration (and 0001 / 0002) is applied manually to
-- Supabase via the MCP `apply_migration` tool, not via `drizzle-kit migrate`.
-- The drizzle journal (`drizzle/meta/_journal.json`) only tracks the initial
-- snapshot (`0000_parallel_dust`); subsequent SQL files in this directory are
-- the authoritative DDL source of truth and must be applied by hand.
--
-- Glyph extractions are modelled as a stream of immutable episodes (RFC 6902
-- JSON Patches) grouped under a session. Two time axes are tracked:
--
--   * applied_at   -- when the patch was written (transaction time).
--   * valid_from   -- when the asserted facts started being true.
--   * valid_to     -- when those facts ceased being true; NULL = current.
--
-- Episodes are never updated in place. To revise history we insert a new
-- episode and (optionally) point the older row's `superseded_by` at the
-- newer one. Reconstructing document state at time T means replaying every
-- episode where `valid_from <= T AND (valid_to IS NULL OR valid_to > T)`,
-- ordered by applied_at.
--
-- A session aggregates the model usage (tokens / cost) of every episode it
-- produced; per-episode counters remain on the episode row so individual
-- patches can be costed without joining.

CREATE TABLE "extraction_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "doc_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES auth.users("id") ON DELETE CASCADE,
  "schema_type" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at" timestamp with time zone,
  "total_tokens_in" integer NOT NULL DEFAULT 0,
  "total_tokens_out" integer NOT NULL DEFAULT 0,
  "total_cached_tokens" integer NOT NULL DEFAULT 0,
  "total_cost_micros" bigint NOT NULL DEFAULT 0,
  "model" text NOT NULL DEFAULT 'gemini-2.5-flash-lite'
);
--> statement-breakpoint
CREATE INDEX "idx_sessions_user_started" ON "extraction_sessions" ("user_id", "started_at" DESC);
--> statement-breakpoint

CREATE TABLE "extraction_episodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "doc_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES auth.users("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL REFERENCES "extraction_sessions"("id") ON DELETE CASCADE,
  "applied_at" timestamp with time zone NOT NULL DEFAULT now(),
  "valid_from" timestamp with time zone NOT NULL,
  "valid_to" timestamp with time zone,
  "patch" jsonb NOT NULL,
  "source_offset_start" integer,
  "source_offset_end" integer,
  "model" text NOT NULL,
  "tokens_in" integer NOT NULL DEFAULT 0,
  "tokens_out" integer NOT NULL DEFAULT 0,
  "cached_tokens" integer NOT NULL DEFAULT 0,
  "superseded_by" uuid REFERENCES "extraction_episodes"("id"),
  "schema_version" text NOT NULL DEFAULT '1.0'
);
--> statement-breakpoint
CREATE INDEX "idx_episodes_doc_valid" ON "extraction_episodes" ("doc_id") WHERE "valid_to" IS NULL;
--> statement-breakpoint
CREATE INDEX "idx_episodes_session" ON "extraction_episodes" ("session_id");
--> statement-breakpoint
CREATE INDEX "idx_episodes_user_applied" ON "extraction_episodes" ("user_id", "applied_at" DESC);
--> statement-breakpoint
CREATE INDEX "idx_episodes_doc_applied" ON "extraction_episodes" ("doc_id", "applied_at");
--> statement-breakpoint

-- RLS ----------------------------------------------------------------------
-- service_role bypasses RLS automatically; server-side code must filter by
-- ctx.user.id (see apps/web/src/server/trpc.ts).

alter table extraction_sessions enable row level security;

drop policy if exists "extraction_sessions_select_own" on extraction_sessions;
create policy "extraction_sessions_select_own" on extraction_sessions
  for select using (user_id = auth.uid());

drop policy if exists "extraction_sessions_insert_own" on extraction_sessions;
create policy "extraction_sessions_insert_own" on extraction_sessions
  for insert with check (user_id = auth.uid());

alter table extraction_episodes enable row level security;

drop policy if exists "extraction_episodes_select_own" on extraction_episodes;
create policy "extraction_episodes_select_own" on extraction_episodes
  for select using (user_id = auth.uid());

drop policy if exists "extraction_episodes_insert_own" on extraction_episodes;
create policy "extraction_episodes_insert_own" on extraction_episodes
  for insert with check (user_id = auth.uid());
