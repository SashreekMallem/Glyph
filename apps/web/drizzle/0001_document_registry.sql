-- Document type registry: move schemas + templates to runtime-editable tables.

CREATE TABLE "document_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "schema_version" text NOT NULL DEFAULT '1.0',
  "json_schema" jsonb NOT NULL,
  "renderer_id" text NOT NULL DEFAULT 'generic',
  "is_system" boolean NOT NULL DEFAULT false,
  "user_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_key_unique" ON "document_types" ("key");
--> statement-breakpoint
CREATE INDEX "document_types_user_id_idx" ON "document_types" ("user_id");
--> statement-breakpoint

CREATE TABLE "document_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_type_id" uuid NOT NULL REFERENCES "document_types"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "descriptors" jsonb NOT NULL,
  "is_system" boolean NOT NULL DEFAULT false,
  "user_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "document_templates_type_idx" ON "document_templates" ("document_type_id");
--> statement-breakpoint
CREATE INDEX "document_templates_user_id_idx" ON "document_templates" ("user_id");
--> statement-breakpoint

-- Bridge the existing documents.document_type enum column to the new registry.
ALTER TABLE "documents" ADD COLUMN "document_type_key" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "template_id" uuid;
--> statement-breakpoint
-- Backfill: existing rows already carry contract/resume/invoice/custom enum.
UPDATE "documents" SET "document_type_key" = "document_type"::text WHERE "document_type_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "document_type_key" SET NOT NULL;
