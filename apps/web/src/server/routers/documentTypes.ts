/**
 * tRPC router exposing the runtime document-type + template registry.
 *
 * Reads: any authenticated user can list system types/templates plus
 * their own.
 * Writes: a user can create, rename, edit descriptors of their own
 * types/templates. System rows are read-only.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  documentTemplates,
  documentTypes,
  type DocumentTemplate,
  type DocumentTypeRow,
} from "@/db/schema";
import { protectedProcedure, router } from "../trpc";

const DescriptorSchema = z
  .object({
    path: z.string().min(1),
    label: z.string().min(1),
    section: z.string().min(1),
    type: z.enum(["string", "number", "boolean", "date"]).optional(),
    placeholder: z.string().optional(),
  })
  .strict();

const DescriptorsArray = z.array(DescriptorSchema).min(1);

export interface DocumentTypeDTO {
  id: string;
  key: string;
  name: string;
  description: string | null;
  schemaVersion: string;
  rendererId: string;
  isSystem: boolean;
  isMine: boolean;
}

export interface DocumentTemplateDTO {
  id: string;
  documentTypeId: string;
  name: string;
  description: string | null;
  descriptors: unknown;
  isSystem: boolean;
  isMine: boolean;
}

function toTypeDTO(r: DocumentTypeRow, userId: string): DocumentTypeDTO {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    schemaVersion: r.schemaVersion,
    rendererId: r.rendererId,
    isSystem: r.isSystem,
    isMine: r.userId === userId,
  };
}

function toTemplateDTO(r: DocumentTemplate, userId: string): DocumentTemplateDTO {
  return {
    id: r.id,
    documentTypeId: r.documentTypeId,
    name: r.name,
    description: r.description,
    descriptors: r.descriptors,
    isSystem: r.isSystem,
    isMine: r.userId === userId,
  };
}

export const documentTypesRouter = router({
  listTypes: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.select().from(documentTypes);
    return rows
      .filter((r) => r.isSystem || r.userId === ctx.user.id)
      .map((r) => toTypeDTO(r, ctx.user.id));
  }),

  getTypeByKey: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(documentTypes)
        .where(eq(documentTypes.key, input.key))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (!row.isSystem && row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return toTypeDTO(row, ctx.user.id);
    }),

  listTemplatesForType: protectedProcedure
    .input(z.object({ typeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.documentTypeId, input.typeId));
      return rows
        .filter((r) => r.isSystem || r.userId === ctx.user.id)
        .map((r) => toTemplateDTO(r, ctx.user.id));
    }),

  getTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (!row.isSystem && row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return toTemplateDTO(row, ctx.user.id);
    }),

  getDefaultForKey: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [type] = await db
        .select()
        .from(documentTypes)
        .where(eq(documentTypes.key, input.key))
        .limit(1);
      if (!type) throw new TRPCError({ code: "NOT_FOUND" });
      if (!type.isSystem && type.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const [template] = await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.documentTypeId, type.id))
        .limit(1);
      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No template seeded for type ${input.key}.`,
        });
      }
      return {
        type: toTypeDTO(type, ctx.user.id),
        template: toTemplateDTO(template, ctx.user.id),
      };
    }),

  upsertTemplate: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        documentTypeId: z.string().uuid(),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        descriptors: DescriptorsArray,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // User must own (or be allowed to write templates against) the type.
      // System types are authored against globally — users just add their
      // own template rows.
      const [type] = await db
        .select()
        .from(documentTypes)
        .where(eq(documentTypes.id, input.documentTypeId))
        .limit(1);
      if (!type) throw new TRPCError({ code: "NOT_FOUND" });
      if (!type.isSystem && type.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      if (input.id) {
        const [existing] = await db
          .select()
          .from(documentTemplates)
          .where(eq(documentTemplates.id, input.id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.isSystem) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "System templates cannot be edited. Clone first.",
          });
        }
        if (existing.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const [updated] = await db
          .update(documentTemplates)
          .set({
            name: input.name,
            description: input.description ?? null,
            descriptors: input.descriptors,
            updatedAt: new Date(),
          })
          .where(eq(documentTemplates.id, input.id))
          .returning();
        if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return toTemplateDTO(updated, ctx.user.id);
      }

      const [inserted] = await db
        .insert(documentTemplates)
        .values({
          documentTypeId: input.documentTypeId,
          name: input.name,
          description: input.description ?? null,
          descriptors: input.descriptors,
          isSystem: false,
          userId: ctx.user.id,
        })
        .returning();
      if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return toTemplateDTO(inserted, ctx.user.id);
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "System templates cannot be deleted.",
        });
      }
      if (existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await db
        .delete(documentTemplates)
        .where(
          and(
            eq(documentTemplates.id, input.id),
            eq(documentTemplates.userId, ctx.user.id),
          ),
        );
      return { ok: true as const };
    }),
});
