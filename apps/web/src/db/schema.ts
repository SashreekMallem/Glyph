/**
 * Glyph database schema.
 *
 * Notes:
 * - `users_profile.id` and `documents.user_id` reference `auth.users(id)`
 *   in the Supabase `auth` schema. Drizzle cannot enforce cross-schema
 *   foreign keys, so the relationship is documented here and enforced
 *   by migration SQL where possible, and by application code otherwise.
 * - Row Level Security policies for all user-owned tables live in
 *   `drizzle/rls.sql` and must be applied separately in Supabase.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "pro", "team", "enterprise"]);
/**
 * NOTE on `documentTypeEnum`:
 *
 * This enum is kept for backwards compatibility with existing rows (and
 * the three built-in types). The authoritative registry is now the
 * `documentTypes` table, which supports runtime-added types. New types
 * live only in that table — the enum is NOT extended.
 *
 * `documents.documentType` stores the enum value when it is one of the
 * built-ins ("contract" | "resume" | "invoice"). For user-defined types
 * the column stores `"custom"` and `documents.documentTypeKey` points
 * at a `documentTypes.key` row that carries the full schema + template.
 */
export const documentTypeEnum = pgEnum("document_type", [
  "contract",
  "resume",
  "invoice",
  "custom",
]);
export const exportFormatEnum = pgEnum("export_format", [
  "pdf",
  "docx",
  "gdocs",
  "json",
]);

/**
 * Runtime registry of every document type Glyph knows about.
 *
 * The three built-ins are seeded with `isSystem = true` and `key` =
 * "contract" | "resume" | "invoice". Their `jsonSchema` mirrors the
 * compile-time Zod schema in `@glyph/schema-library`; if the two ever
 * diverge, the compile-time schema wins for built-ins (it is what the
 * PDF renderer and the MCP heuristic use). For user-defined types the
 * `jsonSchema` column is the sole source of truth and is compiled to a
 * runtime Zod validator via `@glyph/schema-library/runtime`.
 */
export const documentTypes = pgTable(
  "document_types",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Stable slug used everywhere as the primary identifier. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    schemaVersion: text("schema_version").notNull().default("1.0"),
    /** JSON Schema Draft 7 document describing valid payloads. */
    jsonSchema: jsonb("json_schema").notNull(),
    /**
     * Identifier for the PDF renderer to use. For built-ins this is
     * "contract" | "resume" | "invoice"; for custom types it defaults to
     * "generic" (a simple label/value renderer).
     */
    rendererId: text("renderer_id").notNull().default("generic"),
    /** System (built-in) rows cannot be edited or deleted by users. */
    isSystem: boolean("is_system").notNull().default(false),
    /** Null for system rows; user-id for custom user-defined types. */
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    keyUnique: uniqueIndex("document_types_key_unique").on(t.key),
    userIdx: index("document_types_user_id_idx").on(t.userId),
  }),
);

/**
 * Editable field descriptors powering the editor UI.
 *
 * A template is a presentation of a document type: which fields to
 * render, their labels, their section grouping, their order, and their
 * coercion hint. Labels can be changed without shipping a build;
 * sections can be renamed or reordered by any user with access.
 *
 * Every document type must have at least one system template (seeded
 * as `isSystem = true`). Users can clone and customise to taste.
 */
export const documentTemplates = pgTable(
  "document_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentTypeId: uuid("document_type_id")
      .notNull()
      .references(() => documentTypes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * Ordered array of `FieldDescriptor` objects:
     *   { path, label, section, type?, placeholder? }
     * Serialized verbatim to the UI; changes here propagate on next load.
     */
    descriptors: jsonb("descriptors").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    /** Null for system templates; user-id for user-owned ones. */
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    typeIdx: index("document_templates_type_idx").on(t.documentTypeId),
    userIdx: index("document_templates_user_id_idx").on(t.userId),
  }),
);

export const usersProfile = pgTable("users_profile", {
  // references auth.users(id) — enforced in Supabase, not by Drizzle.
  id: uuid("id").primaryKey(),
  fullName: text("full_name"),
  company: text("company"),
  plan: planEnum("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // references auth.users(id)
    userId: uuid("user_id").notNull(),
    title: text("title").notNull(),
    documentType: documentTypeEnum("document_type").notNull(),
    /**
     * Stable key into `document_types.key`. For built-ins this equals
     * the enum value ("contract" | "resume" | "invoice"). For custom
     * types the enum column is "custom" and this column disambiguates.
     */
    documentTypeKey: text("document_type_key").notNull(),
    /** Optional FK to the template the user authored against. */
    templateId: uuid("template_id"),
    schemaVersion: text("schema_version").notNull().default("1.0"),
    prosemirrorState: jsonb("prosemirror_state"),
    /**
     * Plaintext validated JSON. Server-only; never returned by public APIs
     * except the authenticated extract endpoint (which uses the encrypted
     * column) or internal owner reads prior to finalization.
     */
    validatedJson: jsonb("validated_json"),
    encryptedPayload: text("encrypted_payload"),
    payloadSignature: text("payload_signature"),
    payloadIv: text("payload_iv"),
    payloadTag: text("payload_tag"),
    isFinalized: boolean("is_finalized").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("documents_user_id_idx").on(t.userId),
  }),
);

export const documentExports = pgTable("document_exports", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  format: exportFormatEnum("format").notNull(),
  gdocsFileId: text("gdocs_file_id"),
  exportedAt: timestamp("exported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    requestCount: integer("request_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    keyHashUnique: uniqueIndex("api_keys_key_hash_unique").on(t.keyHash),
    keyPrefixUnique: uniqueIndex("api_keys_key_prefix_unique").on(t.keyPrefix),
    userIdx: index("api_keys_user_id_idx").on(t.userId),
  }),
);

export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    documentId: uuid("document_id"),
    documentType: documentTypeEnum("document_type"),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    apiKeyIdx: index("api_usage_api_key_id_idx").on(t.apiKeyId),
    processedAtIdx: index("api_usage_processed_at_idx").on(t.processedAt),
  }),
);

export type UserProfile = typeof usersProfile.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentExport = typeof documentExports.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiUsage = typeof apiUsage.$inferSelect;
export type DocumentTypeRow = typeof documentTypes.$inferSelect;
export type NewDocumentTypeRow = typeof documentTypes.$inferInsert;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type NewDocumentTemplate = typeof documentTemplates.$inferInsert;
