-- Migrate doc_type columns from the document_type enum to plain text.
--
-- APPLICATION NOTE: Like the other migrations in this directory, applied
-- manually to Supabase via the MCP `apply_migration` tool, not via
-- `drizzle-kit migrate`. The Drizzle schema is updated in lockstep in
-- `apps/web/src/db/schema.ts`.
--
-- Why: Glyph's schemas are dynamic — looked up from the `document_types`
-- table or synthesized by Gemini for novel domains. A 4-value enum
-- (`contract | resume | invoice | custom`) defeats that design and
-- silently forces every user-defined type into `"custom"`.

ALTER TABLE api_usage ALTER COLUMN document_type TYPE text USING document_type::text;
--> statement-breakpoint
ALTER TABLE documents ALTER COLUMN document_type TYPE text USING document_type::text;
--> statement-breakpoint
ALTER TABLE span_corrections ALTER COLUMN doc_type TYPE text USING doc_type::text;
--> statement-breakpoint

-- Drop the enum type now that nothing references it.
DROP TYPE document_type;
