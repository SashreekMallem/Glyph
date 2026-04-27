import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { apiKeys, apiUsage } from "@/db/schema";
import { protectedProcedure, rateLimited, router } from "../trpc";
import { toApiKeyDTO } from "../dto";
import { generateApiKey } from "@glyph/crypto";

const perUserWrite = rateLimited("apiKeys", 20, "1 m");

const ApiKeyDTOSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  requestCount: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export const apiKeysRouter = router({
  create: protectedProcedure
    .use(perUserWrite)
    .input(z.object({ name: z.string().min(1).max(50) }))
    .output(
      z.object({
        id: z.string().uuid(),
        key: z.string(),
        prefix: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { raw, hash, prefix } = generateApiKey();
      const [row] = await db
        .insert(apiKeys)
        .values({
          userId: ctx.user.id,
          name: input.name,
          keyHash: hash,
          keyPrefix: prefix,
        })
        .returning({ id: apiKeys.id });
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to persist API key.",
        });
      }
      return { id: row.id, key: raw, prefix };
    }),

  list: protectedProcedure
    .output(z.array(ApiKeyDTOSchema))
    .query(async ({ ctx }) => {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, ctx.user.id));
      return rows.map(toApiKeyDTO);
    }),

  revoke: protectedProcedure
    .use(perUserWrite)
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db
        .update(apiKeys)
        .set({ isActive: false })
        .where(
          and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)),
        )
        .returning({ id: apiKeys.id });
      if (updated.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ok: true };
    }),

  getUsage: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        days: z.number().int().min(1).max(365).default(30),
      }),
    )
    .output(
      z.array(
        z.object({ date: z.string(), count: z.number().int().nonnegative() }),
      ),
    )
    .query(async ({ ctx, input }) => {
      // Confirm ownership first.
      const [key] = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(
          and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)),
        )
        .limit(1);
      if (!key) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const dayExpr = sql<string>`to_char(${apiUsage.processedAt}, 'YYYY-MM-DD')`;
      const rows = await db
        .select({ date: dayExpr, count: count() })
        .from(apiUsage)
        .where(
          and(
            eq(apiUsage.apiKeyId, input.id),
            gte(apiUsage.processedAt, since),
          ),
        )
        .groupBy(dayExpr)
        .orderBy(dayExpr);
      return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
    }),

  getRecentUsage: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .output(
      z.array(
        z.object({
          id: z.string().uuid(),
          apiKeyId: z.string().uuid(),
          apiKeyName: z.string(),
          apiKeyPrefix: z.string(),
          documentId: z.string().uuid().nullable(),
          documentType: z.string().nullable(),
          processedAt: z.string(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const ownedKeys = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.keyPrefix,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, ctx.user.id));
      if (ownedKeys.length === 0) return [];
      const keyIds = ownedKeys.map((k) => k.id);
      const rows = await db
        .select()
        .from(apiUsage)
        .where(inArray(apiUsage.apiKeyId, keyIds))
        .orderBy(desc(apiUsage.processedAt))
        .limit(input.limit);
      const keyById = new Map(ownedKeys.map((k) => [k.id, k]));
      return rows.map((r) => {
        const k = keyById.get(r.apiKeyId);
        return {
          id: r.id,
          apiKeyId: r.apiKeyId,
          apiKeyName: k?.name ?? "",
          apiKeyPrefix: k?.prefix ?? "",
          documentId: r.documentId,
          documentType: r.documentType,
          processedAt: r.processedAt.toISOString(),
        };
      });
    }),

  getStats: protectedProcedure
    .output(
      z.object({
        extracted7d: z.number().int().nonnegative(),
        extracted30d: z.number().int().nonnegative(),
        activeKeys: z.number().int().nonnegative(),
      }),
    )
    .query(async ({ ctx }) => {
      const ownedKeys = await db
        .select({ id: apiKeys.id, isActive: apiKeys.isActive })
        .from(apiKeys)
        .where(eq(apiKeys.userId, ctx.user.id));
      const activeKeys = ownedKeys.filter((k) => k.isActive).length;
      if (ownedKeys.length === 0) {
        return { extracted7d: 0, extracted30d: 0, activeKeys: 0 };
      }
      const keyIds = ownedKeys.map((k) => k.id);
      const now = Date.now();
      const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const [c7] = await db
        .select({ c: count() })
        .from(apiUsage)
        .where(
          and(
            inArray(apiUsage.apiKeyId, keyIds),
            gte(apiUsage.processedAt, since7),
          ),
        );
      const [c30] = await db
        .select({ c: count() })
        .from(apiUsage)
        .where(
          and(
            inArray(apiUsage.apiKeyId, keyIds),
            gte(apiUsage.processedAt, since30),
          ),
        );
      return {
        extracted7d: Number(c7?.c ?? 0),
        extracted30d: Number(c30?.c ?? 0),
        activeKeys,
      };
    }),
});
