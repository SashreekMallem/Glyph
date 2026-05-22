-- Span corrections — captures user feedback on GLiNER2 (or Gemini) extractions.
--
-- APPLICATION NOTE: Like the other migrations in this directory, this file is
-- applied manually to Supabase via the MCP `apply_migration` tool, not via
-- `drizzle-kit migrate`. The Drizzle schema is updated in lockstep in
-- `apps/web/src/db/schema.ts`.
--
-- Each row captures one path-level correction: the user told us the GLiNER2
-- output for `path` was wrong, and here is the right value (and optionally
-- the right label/category). Over time these rows are the training signal
-- that lets us fine-tune GLiNER2 to whatever the user's corpus actually
-- looks like, while leaving the original extraction history (in
-- `extraction_episodes`) untouched.

CREATE TABLE "span_corrections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES auth.users("id") ON DELETE CASCADE,
  "doc_id" uuid REFERENCES "documents"("id") ON DELETE SET NULL,
  "doc_type" document_type NOT NULL,
  "path" text NOT NULL,                       -- dot-notation: "personal.full_name"
  "original_value" text,                      -- what GLiNER2 returned
  "corrected_value" text NOT NULL,            -- what the user changed it to
  "original_label" text,                      -- what GLiNER2 labeled it as
  "corrected_label" text,                     -- new label if the user re-categorized
  "confidence" numeric(4,3),                  -- GLiNER2 confidence at correction time
  "region_start" integer,
  "region_end" integer,
  "source_text" text,                         -- the actual text snippet
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_span_corrections_user" ON "span_corrections" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_span_corrections_doctype" ON "span_corrections" ("doc_type");
--> statement-breakpoint
CREATE INDEX "idx_span_corrections_created" ON "span_corrections" ("created_at" DESC);
--> statement-breakpoint

-- RLS ----------------------------------------------------------------------
-- service_role bypasses RLS automatically; server-side code must filter by
-- ctx.user.id (see apps/web/src/server/trpc.ts).

ALTER TABLE "span_corrections" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own corrections" ON "span_corrections";
CREATE POLICY "Users see own corrections" ON "span_corrections"
  FOR ALL USING (auth.uid() = user_id);
