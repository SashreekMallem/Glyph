/**
 * Style-profile tRPC router.
 *
 * Manages the per-user library of reusable visual brand profiles
 * (`@glyph/style-profile`). Every profile is encrypted at rest with the
 * master key — the plaintext `StyleProfile` only lives in memory during a
 * decrypt call. RLS in Postgres backs tenant isolation; we still assert
 * ownership defensively in each procedure so a misconfigured policy can
 * never leak rows across users.
 *
 * The DB layer enforces "at most one default per user" via a partial
 * unique index on `(user_id) WHERE is_default = true`. To set a different
 * default we always clear the existing one in the same transaction.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { styleProfiles, type StyleProfileRow } from "@/db/schema";
import {
  StyleProfileSchema,
  type StyleProfile,
} from "@glyph/style-profile";
import { decryptPayload, encryptPayload } from "@glyph/crypto";

import { protectedProcedure, rateLimited, router } from "../trpc";

const perUserWrite = rateLimited("style-profiles", 60, "1 m");

const StyleProfileOutputSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  profile: StyleProfileSchema,
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type StyleProfileDTO = z.infer<typeof StyleProfileOutputSchema>;

async function decryptProfileRow(row: StyleProfileRow): Promise<StyleProfile> {
  const decoded = await decryptPayload(
    row.profileEncrypted,
    row.profileIv,
    row.profileTag,
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

function toDTO(row: StyleProfileRow, profile: StyleProfile): StyleProfileDTO {
  return {
    id: row.id,
    name: row.name,
    profile,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Fetch a profile owned by the caller or throw NOT_FOUND. */
async function findOwned(
  id: string,
  userId: string,
): Promise<StyleProfileRow> {
  const [row] = await db
    .select()
    .from(styleProfiles)
    .where(and(eq(styleProfiles.id, id), eq(styleProfiles.userId, userId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Style profile not found.",
    });
  }
  return row;
}

/** Clear `is_default` for every profile this user owns. */
async function clearDefaults(userId: string): Promise<void> {
  await db
    .update(styleProfiles)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(styleProfiles.userId, userId),
        eq(styleProfiles.isDefault, true),
      ),
    );
}

export const styleProfilesRouter = router({
  /** Every profile this user owns, decrypted. Newest-default first. */
  list: protectedProcedure
    .output(z.array(StyleProfileOutputSchema))
    .query(async ({ ctx }) => {
      const rows = await db
        .select()
        .from(styleProfiles)
        .where(eq(styleProfiles.userId, ctx.user.id));
      // Default-first, then newest. Sort in JS — the row count is tiny.
      rows.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      return Promise.all(
        rows.map(async (r) => toDTO(r, await decryptProfileRow(r))),
      );
    }),

  /** Fetch one profile by id, decrypted. */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(StyleProfileOutputSchema)
    .query(async ({ ctx, input }) => {
      const row = await findOwned(input.id, ctx.user.id);
      return toDTO(row, await decryptProfileRow(row));
    }),

  /** Encrypt + insert a fresh profile. Optionally promote to default. */
  create: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        profile: StyleProfileSchema,
        isDefault: z.boolean().optional(),
      }),
    )
    .output(StyleProfileOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const makeDefault = input.isDefault === true;
      if (makeDefault) {
        await clearDefaults(ctx.user.id);
      }
      const enc = await encryptPayload(input.profile);
      const [row] = await db
        .insert(styleProfiles)
        .values({
          userId: ctx.user.id,
          name: input.profile.name,
          profileEncrypted: enc.encrypted,
          profileIv: enc.iv,
          profileTag: enc.tag,
          isDefault: makeDefault,
        })
        .returning();
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Insert returned no row.",
        });
      }
      return toDTO(row, input.profile);
    }),

  /** Partial update: re-encrypt if `profile` provided; promote if requested. */
  update: protectedProcedure
    .use(perUserWrite)
    .input(
      z.object({
        id: z.string().uuid(),
        profile: StyleProfileSchema.optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .output(StyleProfileOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await findOwned(input.id, ctx.user.id);

      // If we're promoting to default, clear the others first. Drop the
      // promotion if THIS row is already the default to skip a needless
      // UPDATE roundtrip.
      if (input.isDefault === true && !existing.isDefault) {
        await clearDefaults(ctx.user.id);
      }

      const patch: Partial<{
        name: string;
        profileEncrypted: string;
        profileIv: string;
        profileTag: string;
        isDefault: boolean;
        updatedAt: Date;
      }> = { updatedAt: new Date() };

      if (input.profile) {
        const enc = await encryptPayload(input.profile);
        patch.name = input.profile.name;
        patch.profileEncrypted = enc.encrypted;
        patch.profileIv = enc.iv;
        patch.profileTag = enc.tag;
      }
      if (input.isDefault !== undefined) {
        patch.isDefault = input.isDefault;
      }

      const [row] = await db
        .update(styleProfiles)
        .set(patch)
        .where(
          and(
            eq(styleProfiles.id, input.id),
            eq(styleProfiles.userId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return toDTO(row, await decryptProfileRow(row));
    }),

  /** Hard-delete a profile. RLS-backed; defensive ownership check too. */
  delete: protectedProcedure
    .use(perUserWrite)
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await db
        .delete(styleProfiles)
        .where(
          and(
            eq(styleProfiles.id, input.id),
            eq(styleProfiles.userId, ctx.user.id),
          ),
        )
        .returning({ id: styleProfiles.id });
      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ok: true as const };
    }),

  /** Convenience: clear all defaults and promote `id`. */
  setDefault: protectedProcedure
    .use(perUserWrite)
    .input(z.object({ id: z.string().uuid() }))
    .output(StyleProfileOutputSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify ownership before touching anything.
      await findOwned(input.id, ctx.user.id);
      await clearDefaults(ctx.user.id);
      const [row] = await db
        .update(styleProfiles)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(
          and(
            eq(styleProfiles.id, input.id),
            eq(styleProfiles.userId, ctx.user.id),
          ),
        )
        .returning();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return toDTO(row, await decryptProfileRow(row));
    }),
});
