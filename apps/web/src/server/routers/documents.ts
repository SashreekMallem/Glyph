import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  documentExports,
  documents,
  documentTypes,
  type Document,
} from "@/db/schema";
import { protectedProcedure, rateLimited, router } from "../trpc";
import { toDocumentDTO } from "../dto";
import { canonicalize } from "@/lib/canonicalize";
import { decryptPayload, encryptPayload, signPayload } from "@glyph/crypto";
import {
  type GlyphDocument,
} from "@glyph/schema-library";
import { getValidatorForType, isBuiltInType } from "../documentRegistry";
import { generatePdf } from "@/lib/pdf";
import {
  EXPORTS_BUCKET,
  getSupabaseServiceClient,
} from "@/lib/supabase/storage";

const documentTypeEnum = z.enum(["contract", "resume", "invoice", "custom"]);

const DocumentDTOSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  documentType: documentTypeEnum,
  schemaVersion: z.string(),
  prosemirrorState: z.unknown(),
  isFinalized: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  validatedJson: z.unknown().optional(),
});

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
  const schema = await getValidatorForType(typeKey);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "validatedJson failed schema validation.",
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

      const enumValue = isBuiltInType(input.typeKey)
        ? input.typeKey
        : ("custom" as const);

      const [row] = await db
        .insert(documents)
        .values({
          userId: ctx.user.id,
          title: input.title,
          documentType: enumValue,
          documentTypeKey: input.typeKey,
          templateId: input.templateId ?? null,
          schemaVersion: typeRow.schemaVersion,
        })
        .returning();
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Insert returned no row.",
        });
      }
      return toDocumentDTO(row);
    }),

  save: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        id: z.string().uuid(),
        prosemirrorState: z.unknown(),
        validatedJson: z.unknown(),
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
      try {
        toStore = await validateAgainstTypeKey(
          existing.documentTypeKey,
          input.validatedJson,
        );
      } catch {
        // Keep the raw partial payload — finalize will re-validate strictly.
        toStore = input.validatedJson;
      }
      const [row] = await db
        .update(documents)
        .set({
          prosemirrorState: input.prosemirrorState,
          validatedJson: toStore,
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
      return toDocumentDTO(row, { includeValidatedJson: true });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(DocumentDTOSchema)
    .query(async ({ ctx, input }) => {
      const row = await findOwned(input.id, ctx.user.id);
      return toDocumentDTO(row, { includeValidatedJson: true });
    }),

  list: protectedProcedure
    .output(z.array(DocumentDTOSchema))
    .query(async ({ ctx }) => {
      const rows = await db
        .select()
        .from(documents)
        .where(eq(documents.userId, ctx.user.id))
        .orderBy(desc(documents.updatedAt));
      return rows.map((r) => toDocumentDTO(r));
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
      if (existing.validatedJson === null || existing.validatedJson === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Document has no validatedJson to finalize.",
        });
      }
      const validated = await validateAgainstTypeKey(
        existing.documentTypeKey,
        existing.validatedJson,
      );
      const canonical = canonicalize(validated);
      if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Canonical payload must be an object.",
        });
      }
      const { encrypted, iv, tag } = await encryptPayload(canonical);
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
      if (row.documentType === "custom") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "PDF export is not yet supported for custom document types.",
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
});
