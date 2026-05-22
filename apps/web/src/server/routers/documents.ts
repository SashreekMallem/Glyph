import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  documentExports,
  documents,
  documentTypes,
  spanCorrections,
  styleProfiles,
  type Document,
} from "@/db/schema";
import { StyleProfileSchema, type StyleProfile } from "@glyph/style-profile";
import { protectedProcedure, rateLimited, router } from "../trpc";
import { toDocumentDTO } from "../dto";
import { canonicalize } from "@/lib/canonicalize";
import { attachMeta, buildMeta, stripMeta } from "@/lib/payload-meta";
import { extractOneShot } from "@/lib/extract/oneshot";
import { detectDrift } from "@/server/drift";
import {
  decryptPayload,
  encryptPayload,
  signPayload,
  verifySignature,
} from "@glyph/crypto";
import {
  getValidatorForType,
  resolveSchema,
} from "../documentRegistry";

// `GlyphDocument` used to be a Zod-derived discriminated union exported
// from `@glyph/schema-library`. With schemas now in the DB, document
// payloads are arbitrary JSON objects validated against the resolved
// runtime schema.
type GlyphDocument = Record<string, unknown>;
import { loadComposition } from "../composition";
import { generatePdf } from "@/lib/pdf";
import {
  EXPORTS_BUCKET,
  getSupabaseServiceClient,
} from "@/lib/supabase/storage";

// Document type keys are now arbitrary strings (sourced from the
// `document_types` table). Output validators just check it's a non-empty
// string.
const documentTypeOutputSchema = z.string().min(1);

const DocumentDTOSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  documentType: documentTypeOutputSchema,
  schemaVersion: z.string(),
  prosemirrorState: z.unknown(),
  isFinalized: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  validatedJson: z.unknown().optional(),
  encryptedPayload: z.string().nullable().optional(),
  payloadIv: z.string().nullable().optional(),
  payloadTag: z.string().nullable().optional(),
  payloadSignature: z.string().nullable().optional(),
  /**
   * Decrypted visual style sidecar (see @glyph/style-profile). Absent
   * when the document has no profile attached or when the on-disk JSON
   * fails schema validation — callers fall back to GLYPH_MODERN_PROFILE
   * in either case.
   */
  styleProfile: StyleProfileSchema.optional(),
});

/**
 * Decrypt one of the at-rest encrypted column triples (encrypted/iv/tag).
 * Returns `null` if any column is null (a fresh document that hasn't been
 * saved yet), or throws on tag-mismatch / corruption. Values are stored
 * as objects (we wrap primitives in `{ v: ... }` on write — see `save`).
 */
async function decryptColumn(
  encrypted: string | null,
  iv: string | null,
  tag: string | null,
): Promise<unknown> {
  if (encrypted === null || iv === null || tag === null) {
    return null;
  }
  const decoded = (await decryptPayload(encrypted, iv, tag)) as
    | { __wrapped?: true; v?: unknown }
    | Record<string, unknown>;
  if (
    decoded &&
    typeof decoded === "object" &&
    (decoded as { __wrapped?: boolean }).__wrapped === true
  ) {
    return (decoded as { v: unknown }).v;
  }
  return decoded;
}

/**
 * Decrypt the style-profile column triple (or return `undefined` if any
 * column is null / the JSON fails schema validation). Used by `get` /
 * `list` so the editor can render an author-specified style profile.
 * Validation failure is intentionally swallowed — the caller treats the
 * profile as absent and falls back to `GLYPH_MODERN_PROFILE` in the UI.
 */
async function decryptStyleProfile(
  encrypted: string | null,
  iv: string | null,
  tag: string | null,
): Promise<StyleProfile | undefined> {
  if (encrypted === null || iv === null || tag === null) {
    return undefined;
  }
  try {
    const decoded = (await decryptPayload(encrypted, iv, tag)) as
      | { __wrapped?: true; v?: unknown }
      | Record<string, unknown>;
    const candidate =
      decoded &&
      typeof decoded === "object" &&
      (decoded as { __wrapped?: boolean }).__wrapped === true
        ? (decoded as { v: unknown }).v
        : decoded;
    const parsed = StyleProfileSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Wrap non-object payloads so AES-GCM (which requires an object) can encrypt them. */
function wrapForEncryption(value: unknown): object {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as object;
  }
  return { __wrapped: true, v: value };
}

const perUserWrite = rateLimited("documents", 100, "1 m");
const perUserExport = rateLimited("documents:export", 10, "1 m");

/** Fetch a document owned by the caller or throw NOT_FOUND. */
async function findOwned(id: string, userId: string): Promise<Document> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
  }
  return row;
}

/** Validate a plaintext payload against its document type's schema.
 *  Built-in types use their compile-time Zod schema; user-defined types
 *  use the DB-stored JSON Schema compiled via the runtime converter.
 */
async function validateAgainstTypeKey(
  typeKey: string,
  json: unknown,
): Promise<unknown> {
  // Manual override for Resume caching issues.
  if (typeKey === "resume" && json && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if (obj.experience === undefined) obj.experience = [];
    if (obj.education === undefined) obj.education = [];
    if (obj.skills === undefined) obj.skills = [];
  }

  const schema = await getValidatorForType(typeKey);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error("Schema validation failed:", JSON.stringify(parsed.error.issues, null, 2));
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `validatedJson failed schema validation: ${JSON.stringify(parsed.error.issues)}`,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Look up a user's style-profile-library row, decrypt + validate it.
 * Throws NOT_FOUND on missing/foreign rows, INTERNAL on malformed JSON.
 * Shared by `create` and `setStyleProfile`.
 */
async function loadOwnedStyleProfile(
  styleProfileId: string,
  userId: string,
): Promise<StyleProfile> {
  const [profRow] = await db
    .select()
    .from(styleProfiles)
    .where(
      and(
        eq(styleProfiles.id, styleProfileId),
        eq(styleProfiles.userId, userId),
      ),
    )
    .limit(1);
  if (!profRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Style profile not found.",
    });
  }
  const decoded = await decryptPayload(
    profRow.profileEncrypted,
    profRow.profileIv,
    profRow.profileTag,
  );
  const parsed = StyleProfileSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Stored style profile failed schema validation.",
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export const documentsRouter = router({
  create: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        /**
         * The document type **key** (e.g. "contract", "nda", "purchase_order").
         * Built-ins and user-registered types both live in `document_types`.
         */
        typeKey: z.string().min(1).max(80),
        title: z.string().min(1).max(200),
        templateId: z.string().uuid().optional(),
        /**
         * Optional brand profile (from the `style_profiles` library) to
         * pre-apply. Verified against caller ownership, then re-encrypted
         * onto the document's own columns — the library row stays
         * untouched, so later renames/deletes don't retroactively
         * re-style created documents.
         */
        styleProfileId: z.string().uuid().optional(),
      }),
    )
    .output(DocumentDTOSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify the type exists + caller has access (system or owned).
      const [typeRow] = await db
        .select()
        .from(documentTypes)
        .where(eq(documentTypes.key, input.typeKey))
        .limit(1);
      if (!typeRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Unknown document type: ${input.typeKey}`,
        });
      }
      if (!typeRow.isSystem && typeRow.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Resolve + copy-encrypt the chosen brand profile, if any. We
      // re-encrypt rather than reuse the library row's ciphertext so
      // each document carries its own IV/tag — master-key rotations
      // never have to chase cross-table refs.
      let styleProfileEncrypted: string | null = null;
      let styleProfileIv: string | null = null;
      let styleProfileTag: string | null = null;
      let resolvedStyleProfile: StyleProfile | undefined;
      if (input.styleProfileId) {
        resolvedStyleProfile = await loadOwnedStyleProfile(
          input.styleProfileId,
          ctx.user.id,
        );
        const enc = await encryptPayload(resolvedStyleProfile);
        styleProfileEncrypted = enc.encrypted;
        styleProfileIv = enc.iv;
        styleProfileTag = enc.tag;
      }

      // `documents.documentType` is the coarse renderer/category column;
      // `documents.documentTypeKey` is the precise key into
      // `document_types`. With every schema now in the DB, the coarse
      // column is always the literal "custom".
      const [row] = await db
        .insert(documents)
        .values({
          userId: ctx.user.id,
          title: input.title,
          documentType: "custom",
          documentTypeKey: input.typeKey,
          templateId: input.templateId ?? null,
          schemaVersion: typeRow.schemaVersion,
          styleProfileEncrypted,
          styleProfileIv,
          styleProfileTag,
        })
        .returning();
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Insert returned no row.",
        });
      }
      // Brand new document — no encrypted state yet.
      return toDocumentDTO(row, {
        includeValidatedJson: true,
        prosemirrorState: null,
        validatedJson: null,
        styleProfile: resolvedStyleProfile,
      });
    }),

  /**
   * Apply (or clear) a saved brand profile on an existing document. The
   * library row is the source of truth — we copy-encrypt its plaintext
   * into the document's own `style_profile_*` columns so subsequent
   * library edits don't retroactively re-style finalized documents.
   * Omit `styleProfileId` to revert to the GLYPH_MODERN default.
   */
  setStyleProfile: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        docId: z.string().uuid(),
        styleProfileId: z.string().uuid().optional(),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      // Defensive ownership check — RLS would also block, but a typed
      // NOT_FOUND is friendlier than a transport-level error.
      await findOwned(input.docId, ctx.user.id);

      let encrypted: string | null = null;
      let iv: string | null = null;
      let tag: string | null = null;

      if (input.styleProfileId) {
        const profile = await loadOwnedStyleProfile(
          input.styleProfileId,
          ctx.user.id,
        );
        const enc = await encryptPayload(profile);
        encrypted = enc.encrypted;
        iv = enc.iv;
        tag = enc.tag;
      }

      await db
        .update(documents)
        .set({
          styleProfileEncrypted: encrypted,
          styleProfileIv: iv,
          styleProfileTag: tag,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documents.id, input.docId),
            eq(documents.userId, ctx.user.id),
          ),
        );

      return { ok: true as const };
    }),

  save: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        id: z.string().uuid(),
        prosemirrorState: z.unknown(),
        validatedJson: z.unknown(),
        /**
         * Optional explicit block-id list. When provided, the resolved
         * composition's id is written to `documents.compositionId` so
         * finalize/export can revive the exact same schema.
         */
        blockIds: z.array(z.string()).optional(),
      }),
    )
    .output(DocumentDTOSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await findOwned(input.id, ctx.user.id);
      if (existing.isFinalized) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Finalized documents cannot be edited.",
        });
      }
      // Autosave is permissive: we persist whatever the user has typed so far,
      // even if it doesn't yet satisfy the full schema. Strict schema
      // validation only runs at `finalize` time — validation *issues* are
      // surfaced live in the UI by the client-side validator plugin, which
      // is the right UX for a prose-first editor where the structure emerges
      // as the user writes. We still run a best-effort parse so that if the
      // payload *does* happen to be fully valid, we store the normalized
      // version (e.g. trimmed/coerced fields).
      let toStore: unknown = input.validatedJson;
      let resolvedCompositionId: string | null = existing.compositionId;
      try {
        const resolved = await resolveSchema({
          documentType: existing.documentTypeKey,
          blockIds: input.blockIds,
          userId: ctx.user.id,
        });
        if (resolved.compositionId !== null) {
          resolvedCompositionId = resolved.compositionId;
        }
        const parsed = resolved.zod.safeParse(input.validatedJson);
        toStore = parsed.success ? parsed.data : input.validatedJson;
      } catch {
        // Keep the raw partial payload — finalize will re-validate strictly.
        toStore = input.validatedJson;
      }
      const pmEnc = await encryptPayload(wrapForEncryption(input.prosemirrorState));
      const vjEnc = await encryptPayload(wrapForEncryption(toStore));
      const [row] = await db
        .update(documents)
        .set({
          prosemirrorEncrypted: pmEnc.encrypted,
          prosemirrorIv: pmEnc.iv,
          prosemirrorTag: pmEnc.tag,
          validatedEncrypted: vjEnc.encrypted,
          validatedIv: vjEnc.iv,
          validatedTag: vjEnc.tag,
          compositionId: resolvedCompositionId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.userId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return toDocumentDTO(row, {
        includeValidatedJson: true,
        prosemirrorState: input.prosemirrorState,
        validatedJson: toStore,
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(DocumentDTOSchema)
    .query(async ({ ctx, input }) => {
      const row = await findOwned(input.id, ctx.user.id);
      const prosemirrorState = await decryptColumn(
        row.prosemirrorEncrypted,
        row.prosemirrorIv,
        row.prosemirrorTag,
      );
      const validatedJson = await decryptColumn(
        row.validatedEncrypted,
        row.validatedIv,
        row.validatedTag,
      );
      const styleProfile = await decryptStyleProfile(
        row.styleProfileEncrypted,
        row.styleProfileIv,
        row.styleProfileTag,
      );
      return toDocumentDTO(row, {
        includeValidatedJson: true,
        prosemirrorState,
        validatedJson,
        styleProfile,
      });
    }),

  list: protectedProcedure
    .output(z.array(DocumentDTOSchema))
    .query(async ({ ctx }) => {
      const rows = await db
        .select()
        .from(documents)
        .where(eq(documents.userId, ctx.user.id))
        .orderBy(desc(documents.updatedAt));
      return Promise.all(
        rows.map(async (r) => {
          const prosemirrorState = await decryptColumn(
            r.prosemirrorEncrypted,
            r.prosemirrorIv,
            r.prosemirrorTag,
          );
          // List view doesn't include validatedJson; skip the decrypt cost.
          return toDocumentDTO(r, { prosemirrorState });
        }),
      );
    }),

  delete: protectedProcedure
    .use(perUserWrite)
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await db
        .delete(documents)
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.userId, ctx.user.id),
          ),
        )
        .returning({ id: documents.id });
      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ok: true };
    }),

  finalize: protectedProcedure
    .use(perUserWrite)
    .input(z.object({ id: z.string().uuid() }))
    .output(DocumentDTOSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await findOwned(input.id, ctx.user.id);
      if (existing.isFinalized) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Document is already finalized.",
        });
      }
      const decryptedValidated = await decryptColumn(
        existing.validatedEncrypted,
        existing.validatedIv,
        existing.validatedTag,
      );
      if (decryptedValidated === null || decryptedValidated === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Document has no validatedJson to finalize.",
        });
      }
      // Prefer the composition the document was authored against. If the
      // row has no compositionId we fall through to the default schema
      // (built-in / custom_type / domain default).
      let validated: unknown;
      if (existing.compositionId !== null) {
        const composed = await loadComposition(existing.compositionId);
        if (composed === null) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Stored composition no longer exists.",
          });
        }
        const parsed = composed.zod.safeParse(decryptedValidated);
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `validatedJson failed schema validation: ${JSON.stringify(parsed.error.issues)}`,
            cause: parsed.error,
          });
        }
        validated = parsed.data;
      } else {
        // Built-in types (resume/contract/invoice) use strict schema validation.
        // Custom agentic documents bypass strict validation at finalize time
        // so that the AI can dynamically evolve the schema.
        if (existing.documentType === "custom") {
          validated = decryptedValidated;
        } else {
          validated = await validateAgainstTypeKey(
            existing.documentTypeKey,
            decryptedValidated,
          );
        }
      }
      const canonical = canonicalize(validated);
      if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Canonical payload must be an object.",
        });
      }
      // Attach `_meta` so downstream readers (sync endpoint, MCP, plugins)
      // can detect drift. Web editor doesn't track per-leaf source regions
      // yet — empty regions force a full re-extract on first sync, then
      // subsequent edits inside the editor stay in lockstep via this same
      // finalize → sync chain.
      const meta = buildMeta({
        sourceText: "",
        regions: {},
        schemaVersion: existing.schemaVersion ?? "1.0",
        blockIds: existing.compositionId !== null ? null : null,
        compositionId: existing.compositionId,
      });
      const withMeta = attachMeta(canonical as Record<string, unknown>, meta);
      const { encrypted, iv, tag } = await encryptPayload(withMeta);
      const signature = await signPayload(encrypted);
      const [row] = await db
        .update(documents)
        .set({
          encryptedPayload: encrypted,
          payloadIv: iv,
          payloadTag: tag,
          payloadSignature: signature,
          isFinalized: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.userId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Strip plaintext from the response.
      return toDocumentDTO(row, { includeValidatedJson: false });
    }),

  /**
   * Self-healing sync for a finalized document. Caller passes the current
   * visible text — the procedure decrypts the embedded payload, runs drift
   * detection against `_meta.regions`, re-extracts any drifted fields, and
   * writes a refreshed signed payload back to the row. Returns the diff so
   * the editor can surface what changed.
   */
  sync: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        id: z.string().uuid(),
        currentText: z.string(),
        regions: z
          .record(
            z.string(),
            z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
          )
          .optional(),
      }),
    )
    .output(
      z.object({
        status: z.enum(["in_sync", "synced", "no_payload"]),
        drift: z
          .object({
            changed: z.array(z.string()),
            added: z.array(z.string()),
            removed: z.array(z.string()),
          })
          .nullable(),
        signatureValid: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await findOwned(input.id, ctx.user.id);
      if (
        row.encryptedPayload === null ||
        row.payloadIv === null ||
        row.payloadTag === null ||
        row.payloadSignature === null
      ) {
        return { status: "no_payload" as const, drift: null, signatureValid: false };
      }

      let signatureValid = false;
      try {
        signatureValid = await verifySignature(
          row.encryptedPayload,
          row.payloadSignature,
        );
      } catch {
        signatureValid = false;
      }

      const decrypted = (await decryptPayload(
        row.encryptedPayload,
        row.payloadIv,
        row.payloadTag,
      )) as Record<string, unknown>;

      const { data: bareData, meta: oldMeta } = stripMeta(decrypted);

      // Without `_meta` we cannot drift-detect — return as-is and let the
      // next finalize attach metadata.
      if (!oldMeta) {
        return {
          status: "in_sync" as const,
          drift: null,
          signatureValid,
        };
      }

      const currentRegions =
        input.regions ?? (oldMeta.regions as Record<string, [number, number]>);
      const drift = detectDrift({
        currentText: input.currentText,
        currentRegions,
        embeddedFingerprints: oldMeta.fingerprints,
        embeddedRegions: oldMeta.regions,
      });

      if (!drift.hasDrift) {
        return {
          status: "in_sync" as const,
          drift: {
            changed: [...drift.changed],
            added: [...drift.added],
            removed: [...drift.removed],
          },
          signatureValid,
        };
      }

      const onlyPaths = [...drift.changed, ...drift.added];
      const reExtract = await extractOneShot({
        text: input.currentText,
        typeKey: row.documentTypeKey,
        userId: ctx.user.id,
        db: db as never,
        docId: row.id,
        onlyPaths: onlyPaths.length > 0 ? onlyPaths : undefined,
      });

      const merged: Record<string, unknown> = {
        ...(bareData as Record<string, unknown>),
      };
      if (reExtract.json && typeof reExtract.json === "object") {
        Object.assign(merged, reExtract.json as Record<string, unknown>);
      }
      for (const path of drift.removed) {
        const parts = path.split(".");
        let cur: Record<string, unknown> | null = merged;
        for (let i = 0; i < parts.length - 1 && cur !== null; i++) {
          const child: unknown = cur[parts[i]!];
          cur = child !== null && typeof child === "object" && !Array.isArray(child)
            ? (child as Record<string, unknown>)
            : null;
        }
        if (cur !== null) delete cur[parts[parts.length - 1]!];
      }

      const newRegions: Record<string, [number, number]> = {
        ...(oldMeta.regions as Record<string, [number, number]>),
        ...reExtract.regions,
      };
      for (const path of drift.removed) delete newRegions[path];

      const newMeta = buildMeta({
        sourceText: input.currentText,
        regions: newRegions,
        schemaVersion: row.schemaVersion ?? "1.0",
        blockIds: oldMeta.blockIds ?? null,
        compositionId: oldMeta.compositionId ?? row.compositionId,
      });
      const canonical = canonicalize(merged);
      if (
        canonical === null ||
        typeof canonical !== "object" ||
        Array.isArray(canonical)
      ) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "sync: canonical merged payload is not an object",
        });
      }
      const withMeta = attachMeta(canonical as Record<string, unknown>, newMeta);
      const enc = await encryptPayload(withMeta);
      const sig = await signPayload(enc.encrypted);

      await db
        .update(documents)
        .set({
          encryptedPayload: enc.encrypted,
          payloadIv: enc.iv,
          payloadTag: enc.tag,
          payloadSignature: sig,
          updatedAt: new Date(),
        })
        .where(
          and(eq(documents.id, input.id), eq(documents.userId, ctx.user.id)),
        );

      return {
        status: "synced" as const,
        drift: {
          changed: [...drift.changed],
          added: [...drift.added],
          removed: [...drift.removed],
        },
        signatureValid,
      };
    }),

  exportPdf: protectedProcedure
    .use(perUserExport)
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await findOwned(input.id, ctx.user.id);
      if (!row.isFinalized) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Document must be finalized before exporting to PDF.",
        });
      }
      if (
        row.encryptedPayload === null ||
        row.payloadIv === null ||
        row.payloadTag === null ||
        row.payloadSignature === null
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Finalized document is missing encryption fields.",
        });
      }


      // Decrypt and validate — we render from the canonical payload that
      // was encrypted at finalize-time.
      let decrypted: unknown;
      try {
        decrypted = await decryptPayload(
          row.encryptedPayload,
          row.payloadIv,
          row.payloadTag,
        );
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stored payload could not be decrypted.",
        });
      }
      // For PDF export we require a built-in renderer — the PDF engine
      // ships layouts for contract/resume/invoice only. Future: dispatch
      // via `documentTypes.rendererId` once a "generic" renderer lands.
      const schema = await getValidatorForType(row.documentTypeKey);
      const parsed = schema.safeParse(decrypted);
      if (!parsed.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stored payload does not match current schema.",
          cause: parsed.error,
        });
      }
      const document = parsed.data as GlyphDocument;

      // If the document was authored against a composition, include both
      // the composition id and the block-id list in the embedded XMP so
      // downstream readers can revive the same schema.
      let xmpCompositionId: string | null = null;
      let xmpBlockIds: readonly string[] | null = null;
      if (row.compositionId !== null) {
        const composed = await loadComposition(row.compositionId);
        if (composed !== null) {
          xmpCompositionId = composed.compositionId;
          xmpBlockIds = composed.blockIds;
        }
      }

      const pdfBytes = await generatePdf({
        document,
        xmp: {
          documentType: row.documentType,
          schemaVersion: row.schemaVersion,
          encrypted: row.encryptedPayload,
          iv: row.payloadIv,
          tag: row.payloadTag,
          signature: row.payloadSignature,
          timestamp: new Date().toISOString(),
          compositionId: xmpCompositionId,
          blockIds: xmpBlockIds,
        },
      });

      // Upload to the `exports` bucket and mint a 1-hour signed URL.
      const supabase = getSupabaseServiceClient();
      const timestamp = Date.now();
      const path = `${ctx.user.id}/${row.id}-${timestamp}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from(EXPORTS_BUCKET)
        .upload(path, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (uploadErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `PDF upload failed: ${uploadErr.message}`,
        });
      }
      const { data: signed, error: signErr } = await supabase.storage
        .from(EXPORTS_BUCKET)
        .createSignedUrl(path, 60 * 60);
      if (signErr || !signed) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not sign URL: ${signErr?.message ?? "unknown"}`,
        });
      }

      await db.insert(documentExports).values({
        documentId: row.id,
        userId: ctx.user.id,
        format: "pdf",
      });

      return { url: signed.signedUrl };
    }),

  exportWord: protectedProcedure
    .use(perUserExport)
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await findOwned(input.id, ctx.user.id);
      await db.insert(documentExports).values({
        documentId: input.id,
        userId: ctx.user.id,
        format: "docx",
      });
      return { url: `/api/v1/documents/${input.id}/export/docx?stub=1` };
    }),

  exportGoogleDocs: protectedProcedure
    .use(perUserExport)
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ googleDocsUrl: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await findOwned(input.id, ctx.user.id);
      await db.insert(documentExports).values({
        documentId: input.id,
        userId: ctx.user.id,
        format: "gdocs",
      });
      return {
        googleDocsUrl: `https://docs.google.com/document/d/stub-${input.id}/edit`,
      };
    }),

  /**
   * Record a user-supplied correction to a GLiNER2/Gemini extraction.
   *
   * The mutation is intentionally schemaless w.r.t. the `path` value
   * because we want to capture corrections against any field anywhere in
   * the validated payload — the training pipeline (offline) reconciles
   * paths against the live schemas. Confidence and source-text are
   * optional so the editor can submit corrections even when GLiNER2
   * didn't return them (e.g. user typed in a value GLiNER missed).
   */
  submitCorrection: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        docId: z.string().uuid().optional(),
        docType: z.enum(["resume", "contract", "invoice"]),
        path: z.string().min(1),
        originalValue: z.string().nullable(),
        correctedValue: z.string(),
        originalLabel: z.string().nullable(),
        correctedLabel: z.string().nullable(),
        confidence: z.number().min(0).max(1).nullable(),
        regionStart: z.number().int().nullable(),
        regionEnd: z.number().int().nullable(),
        sourceText: z.string().nullable(),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      // Drizzle's `numeric` columns are typed as `string | null`. Convert
      // the incoming number to a string with three decimals to match the
      // column's precision(4,3) — Postgres will round otherwise but the
      // explicit conversion keeps the stored representation stable.
      const confidenceStr =
        input.confidence === null ? null : input.confidence.toFixed(3);
      await db.insert(spanCorrections).values({
        userId: ctx.user.id,
        docId: input.docId ?? null,
        docType: input.docType,
        path: input.path,
        originalValue: input.originalValue,
        correctedValue: input.correctedValue,
        originalLabel: input.originalLabel,
        correctedLabel: input.correctedLabel,
        confidence: confidenceStr,
        regionStart: input.regionStart,
        regionEnd: input.regionEnd,
        sourceText: input.sourceText,
      });
      return { ok: true as const };
    }),
});
