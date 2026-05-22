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
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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
    /**
     * Encrypted-at-rest editor state and validated payload.
     *
     * Both the raw ProseMirror document the user typed and the extracted
     * structured JSON are written using {@link encryptPayload} before they
     * touch the DB. The plaintext never lives on disk; decrypt only happens
     * server-side on owner reads (and never crosses the public API as
     * plaintext post-finalization).
     *
     * Each pair is independent so we can rotate or invalidate one without
     * disturbing the other (e.g. drop ProseMirror state on finalize while
     * keeping the validated payload + signature for verification).
     */
    prosemirrorEncrypted: text("prosemirror_encrypted"),
    prosemirrorIv: text("prosemirror_iv"),
    prosemirrorTag: text("prosemirror_tag"),
    validatedEncrypted: text("validated_encrypted"),
    validatedIv: text("validated_iv"),
    validatedTag: text("validated_tag"),
    /**
     * Canonical signed payload, set by `finalize`. This is the authoritative
     * copy embedded in Word/Docs/PDF exports — same bytes everywhere so the
     * `payload_signature` matches whichever surface the consumer reads from.
     */
    encryptedPayload: text("encrypted_payload"),
    payloadSignature: text("payload_signature"),
    payloadIv: text("payload_iv"),
    payloadTag: text("payload_tag"),
    /**
     * Pointer into `schema_compositions` for the resolved adaptive schema
     * this document was authored against. Null for legacy documents that
     * predate the composition resolver.
     */
    compositionId: uuid("composition_id"),
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

/**
 * Bi-temporal extraction tracking.
 *
 * Each `extraction_sessions` row groups the episodes produced by a single
 * model run for a single document. Aggregate token/cost counters mirror the
 * per-episode counters so cost reporting can be answered without joins.
 *
 * `extraction_episodes` rows are immutable RFC 6902 JSON patches. To revise
 * the asserted facts without rewriting history we insert a new episode and
 * point the older row's `supersededBy` at it. Two time axes are kept:
 *   - `appliedAt`  — when the patch was written (transaction time).
 *   - `validFrom`  — when the asserted facts started being true.
 *   - `validTo`    — when those facts ceased being true; null = current.
 *
 * `total_cost_micros` and per-document costs are stored as bigint micros
 * (1 USD = 1_000_000) so we never lose sub-cent precision; Drizzle returns
 * bigint columns as `string` by default, hence the `mode: "bigint"` hint.
 */
export const extractionSessions = pgTable(
  "extraction_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // references auth.users(id)
    userId: uuid("user_id").notNull(),
    schemaType: text("schema_type").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    totalTokensIn: integer("total_tokens_in").notNull().default(0),
    totalTokensOut: integer("total_tokens_out").notNull().default(0),
    totalCachedTokens: integer("total_cached_tokens").notNull().default(0),
    totalCostMicros: bigint("total_cost_micros", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    model: text("model").notNull().default("gemini-2.5-flash-lite"),
  },
  (t) => ({
    userStartedIdx: index("idx_sessions_user_started").on(
      t.userId,
      t.startedAt.desc(),
    ),
  }),
);

export const extractionEpisodes = pgTable(
  "extraction_episodes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // references auth.users(id)
    userId: uuid("user_id").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => extractionSessions.id, { onDelete: "cascade" }),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    /** Null = currently valid. */
    validTo: timestamp("valid_to", { withTimezone: true }),
    /** RFC 6902 patch array. */
    patch: jsonb("patch").notNull(),
    sourceOffsetStart: integer("source_offset_start"),
    sourceOffsetEnd: integer("source_offset_end"),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    /** Self-FK; set when a later episode revises this one. */
    supersededBy: uuid("superseded_by"),
    schemaVersion: text("schema_version").notNull().default("1.0"),
  },
  (t) => ({
    docValidIdx: index("idx_episodes_doc_valid")
      .on(t.docId)
      .where(sql`${t.validTo} IS NULL`),
    sessionIdx: index("idx_episodes_session").on(t.sessionId),
    userAppliedIdx: index("idx_episodes_user_applied").on(
      t.userId,
      t.appliedAt.desc(),
    ),
    docAppliedIdx: index("idx_episodes_doc_applied").on(t.docId, t.appliedAt),
  }),
);

/**
 * Adaptive-schema atomic blocks.
 *
 * A `schema_block` is a small, reusable JSON Schema fragment (always
 * `type: "object"`) that contributes properties to a domain's overall
 * schema. The composition resolver merges blocks at runtime to produce
 * the schema a document is validated against.
 */
export const schemaBlocks = pgTable("schema_blocks", {
  id: text("id").primaryKey(), // e.g. "resume.base.v1"
  domain: text("domain").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull().default("1.0"),
  jsonSchema: jsonb("json_schema").notNull(),
  isCurated: boolean("is_curated").notNull().default(false),
  isRequiredForDomain: boolean("is_required_for_domain")
    .notNull()
    .default(false),
  dependsOn: text("depends_on")
    .array()
    .notNull()
    .default(sql`'{}'`),
  usageCount: bigint("usage_count", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  proposedByUserId: uuid("proposed_by_user_id"),
  approvedByUserId: uuid("approved_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Cached compositions of `schema_blocks`. Keyed by a deterministic
 * sha256 fingerprint of the sorted block-id list, so identical
 * compositions are deduped across users. The compiled JSON Schema is
 * the source of truth at runtime — once cached it is never recomputed.
 */
export const schemaCompositions = pgTable(
  "schema_compositions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    domain: text("domain").notNull(),
    blockIds: text("block_ids").array().notNull(),
    fingerprint: text("fingerprint").notNull(),
    compiledJsonSchema: jsonb("compiled_json_schema").notNull(),
    reuseCount: bigint("reuse_count", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    firstSeenUserId: uuid("first_seen_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    fingerprintUnique: uniqueIndex("schema_compositions_fingerprint_unique").on(
      t.fingerprint,
    ),
  }),
);

/**
 * User-submitted proposals for new schema blocks. Reviewed offline and
 * either merged into an existing block or promoted to a curated block.
 */
export const schemaBlockProposals = pgTable("schema_block_proposals", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  domain: text("domain").notNull(),
  proposedName: text("proposed_name").notNull(),
  proposedJsonSchema: jsonb("proposed_json_schema").notNull(),
  rationale: text("rationale"),
  proposedByUserId: uuid("proposed_by_user_id"),
  status: text("status").notNull().default("pending"),
  mergedIntoBlockId: text("merged_into_block_id"),
  reviewNote: text("review_note"),
  reviewedByUserId: uuid("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * OAuth 2.1 dynamic client registration (RFC 7591).
 *
 * One row per MCP client (claude.ai, ChatGPT, custom integrations) that
 * registered itself via POST /api/mcp/oauth/register. The client_secret
 * is stored in plaintext because the MCP spec mandates that public
 * clients (Claude/ChatGPT/Perplexity) use PKCE and DON'T send a secret —
 * the field is kept for RFC 7591 spec compliance even though it's never
 * used to authenticate.
 */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    redirectUris: jsonb("redirect_uris").notNull().$type<string[]>(),
    grantTypes: jsonb("grant_types")
      .notNull()
      .$type<string[]>()
      .default(sql`'["authorization_code","refresh_token"]'::jsonb`),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method")
      .notNull()
      .default("none"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clientIdUnique: uniqueIndex("oauth_clients_client_id_unique").on(t.clientId),
  }),
);

/**
 * Short-lived authorization codes for the OAuth code grant + PKCE flow.
 * Code is created at /authorize when the user clicks Allow, exchanged at
 * /token within 10 min for an access token (a wrapped API key). Single-use.
 */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex("oauth_codes_code_unique").on(t.code),
    expiresIdx: index("oauth_codes_expires_at_idx").on(t.expiresAt),
  }),
);

export type OauthClient = typeof oauthClients.$inferSelect;
export type NewOauthClient = typeof oauthClients.$inferInsert;
export type OauthCode = typeof oauthCodes.$inferSelect;
export type NewOauthCode = typeof oauthCodes.$inferInsert;

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
export type ExtractionSession = typeof extractionSessions.$inferSelect;
export type NewExtractionSession = typeof extractionSessions.$inferInsert;
export type ExtractionEpisode = typeof extractionEpisodes.$inferSelect;
export type NewExtractionEpisode = typeof extractionEpisodes.$inferInsert;
export type SchemaBlock = typeof schemaBlocks.$inferSelect;
export type NewSchemaBlock = typeof schemaBlocks.$inferInsert;
export type SchemaComposition = typeof schemaCompositions.$inferSelect;
export type NewSchemaComposition = typeof schemaCompositions.$inferInsert;
export type SchemaBlockProposal = typeof schemaBlockProposals.$inferSelect;
export type NewSchemaBlockProposal = typeof schemaBlockProposals.$inferInsert;

/**
 * Span corrections — user feedback on GLiNER2/Gemini extractions.
 *
 * Each row captures one path-level correction the user made in the editor:
 * "GLiNER2 returned X at this path, but the right value is Y" (and
 * optionally a re-labeling). These rows are the training signal for
 * fine-tuning the local GLiNER2 model to the user's actual corpus. They
 * are written separately from `extraction_episodes` so the original
 * extraction history stays immutable.
 *
 * `docType` is the built-in `document_type` enum (resume / contract /
 * invoice / custom). For custom types the corrected path is still
 * captured but downstream training will need to consult the
 * `documents.documentTypeKey` for full disambiguation.
 */
export const spanCorrections = pgTable(
  "span_corrections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // references auth.users(id)
    userId: uuid("user_id").notNull(),
    docId: uuid("doc_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    docType: documentTypeEnum("doc_type").notNull(),
    /** Dot-notation path into the validated payload (e.g. "personal.full_name"). */
    path: text("path").notNull(),
    /** What the upstream extractor returned. Null if the field was empty. */
    originalValue: text("original_value"),
    /** What the user changed it to. */
    correctedValue: text("corrected_value").notNull(),
    /** Label/category emitted by GLiNER2 at extraction time. */
    originalLabel: text("original_label"),
    /** New label/category if the user re-categorized the span. */
    correctedLabel: text("corrected_label"),
    /** Confidence reported by GLiNER2 at the time of the correction. */
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    regionStart: integer("region_start"),
    regionEnd: integer("region_end"),
    /** The actual text snippet that was originally extracted. */
    sourceText: text("source_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_span_corrections_user").on(t.userId),
    docTypeIdx: index("idx_span_corrections_doctype").on(t.docType),
    createdIdx: index("idx_span_corrections_created").on(t.createdAt.desc()),
  }),
);

export type SpanCorrection = typeof spanCorrections.$inferSelect;
export type NewSpanCorrection = typeof spanCorrections.$inferInsert;
