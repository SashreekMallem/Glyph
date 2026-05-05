-- Composable schema blocks — the foundation for adaptive document types.
--
-- Architecture:
--   schema_blocks       atomic, versioned JSON Schema fragments (e.g.
--                       "resume.experience.v1", "resume.projects.v1").
--                       Curated once, reused infinitely.
--
--   schema_compositions deterministic combinations of blocks. Two requests
--                       for the same block-set get the SAME composition
--                       row via the `fingerprint` unique index — that's
--                       the reuse cache.
--
--   schema_block_proposals queue of AI-proposed blocks awaiting human
--                          review. Auto-promote when N independent users
--                          request the same field with a similar shape.
--
-- Runtime path (HOT):
--   MCP/API call → resolve block_ids → fingerprint → SELECT composition
--   → use cached compiled_json_schema. Pure DB hit. ~1ms.
--
-- Curation path (COLD, rare):
--   Block missing → propose via AI → admin approves → block joins library
--   → all future docs reuse it. Pay AI once, save forever.

-- ─────────────────────────────────────────────────────────────────────────
-- schema_blocks
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "schema_blocks" (
  "id" text PRIMARY KEY,
  -- e.g. "resume.base.v1", "resume.projects.v1", "contract.arbitration.v1"
  --
  -- Convention: <domain>.<name>.v<version>. The id is content-addressable
  -- in the sense that equal names+versions imply equal schemas; if a block
  -- changes, it gets a new version (v2) — never edit v1 in-place.
  "domain" text NOT NULL,
  -- "resume" | "contract" | "invoice" | <custom-domain>
  "name" text NOT NULL,
  -- "base" | "experience" | "projects" | "publications" | ...
  "version" text NOT NULL DEFAULT '1.0',
  "json_schema" jsonb NOT NULL,
  -- Block-level fragment (an object with `properties`/`required`/etc).
  -- Composition is structural merge, NOT $ref — keeps consumers simple.
  "is_curated" boolean NOT NULL DEFAULT false,
  -- True = human-reviewed and stable. False = AI-proposed, on probation.
  "is_required_for_domain" boolean NOT NULL DEFAULT false,
  -- True for "resume.base.v1" — every resume MUST include this block.
  "depends_on" text[] NOT NULL DEFAULT '{}',
  -- Other block ids this one needs (e.g. "resume.experience.v1" might
  -- depend on "resume.base.v1" for the personal info).
  "usage_count" bigint NOT NULL DEFAULT 0,
  "proposed_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "schema_blocks_domain_idx" ON "schema_blocks"("domain");
CREATE INDEX "schema_blocks_curated_idx" ON "schema_blocks"("is_curated") WHERE "is_curated" = true;
CREATE UNIQUE INDEX "schema_blocks_domain_name_version_unique"
  ON "schema_blocks"("domain", "name", "version");

-- ─────────────────────────────────────────────────────────────────────────
-- schema_compositions
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "schema_compositions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "domain" text NOT NULL,
  -- Sorted block ids — sorted so fingerprint is order-independent.
  "block_ids" text[] NOT NULL,
  -- sha256(sorted_block_ids.join(":")) — the cache key.
  "fingerprint" text NOT NULL,
  -- Materialized merged schema. Generated once at composition time so
  -- the runtime never re-merges.
  "compiled_json_schema" jsonb NOT NULL,
  "reuse_count" bigint NOT NULL DEFAULT 0,
  "first_seen_user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "schema_compositions_fingerprint_unique"
  ON "schema_compositions"("fingerprint");
CREATE INDEX "schema_compositions_domain_idx"
  ON "schema_compositions"("domain");

-- ─────────────────────────────────────────────────────────────────────────
-- schema_block_proposals
-- ─────────────────────────────────────────────────────────────────────────
-- When a user/AI requests a field that doesn't exist as a block, we queue
-- a proposal. Multiple similar proposals signal demand → promote to a real
-- block. This is how the library grows organically without burning AI
-- credits on every doc.
CREATE TABLE "schema_block_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "domain" text NOT NULL,
  "proposed_name" text NOT NULL,
  -- AI-generated proposal for the JSON Schema fragment.
  "proposed_json_schema" jsonb NOT NULL,
  -- Free text from the requester ("resumes need a Patents section").
  "rationale" text,
  "proposed_by_user_id" uuid,
  -- "pending" | "approved" | "rejected" | "merged_into"
  "status" text NOT NULL DEFAULT 'pending',
  -- If status='merged_into', points at the block that absorbed this proposal.
  "merged_into_block_id" text,
  "review_note" text,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "schema_block_proposals_status_idx"
  ON "schema_block_proposals"("status");
CREATE INDEX "schema_block_proposals_domain_name_idx"
  ON "schema_block_proposals"("domain", "proposed_name");

-- ─────────────────────────────────────────────────────────────────────────
-- Wire `documents` to compositions
-- ─────────────────────────────────────────────────────────────────────────
-- A document records which composition it was created against, so reads
-- decode against the exact same schema that was used to write.
ALTER TABLE "documents"
  ADD COLUMN "composition_id" uuid REFERENCES "schema_compositions"("id") ON DELETE SET NULL;

CREATE INDEX "documents_composition_idx" ON "documents"("composition_id");

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — blocks/compositions are GLOBAL (read-everyone), proposals per-user
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "schema_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schema_compositions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schema_block_proposals" ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read curated blocks + compositions.
CREATE POLICY "schema_blocks_read_all" ON "schema_blocks"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "schema_compositions_read_all" ON "schema_compositions"
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can create compositions (it's just a cache row).
CREATE POLICY "schema_compositions_insert_authenticated" ON "schema_compositions"
  FOR INSERT TO authenticated WITH CHECK (true);

-- Users can read their own proposals.
CREATE POLICY "schema_block_proposals_read_own" ON "schema_block_proposals"
  FOR SELECT TO authenticated USING (proposed_by_user_id = auth.uid());

CREATE POLICY "schema_block_proposals_insert_own" ON "schema_block_proposals"
  FOR INSERT TO authenticated WITH CHECK (proposed_by_user_id = auth.uid());

-- Block writes (proposing, approving) go through service-role only —
-- no direct user mutation of the canonical library.
