import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Context } from "./context";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Protected procedure — requires an authenticated Supabase user in ctx.
 * Narrows `ctx.user` from nullable to required for downstream resolvers.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const limiterCache = new Map<string, Ratelimit>();

interface RatelimitEnv {
  readonly url: string;
  readonly token: string;
}

function readRatelimitEnv(): RatelimitEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function getLimiter(
  limit: number,
  window: `${number} ${"s" | "m" | "h" | "d"}`,
): Ratelimit | null {
  const env = readRatelimitEnv();
  if (!env) return null;
  const cacheKey = `${limit}:${window}`;
  const cached = limiterCache.get(cacheKey);
  if (cached) return cached;
  const redis = new Redis({ url: env.url, token: env.token });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    analytics: true,
    prefix: "glyph:trpc",
  });
  limiterCache.set(cacheKey, limiter);
  return limiter;
}

/**
 * Create a middleware that rate-limits by the authenticated user id.
 *
 * If Upstash env vars are not configured (e.g. local dev), this is a
 * no-op rather than failing closed — this keeps `pnpm dev` usable.
 * Production deployments MUST set the Upstash vars.
 */
export function rateLimited(
  identifier: string,
  limit: number,
  window: `${number} ${"s" | "m" | "h" | "d"}`,
) {
  return middleware(async ({ ctx, next }) => {
    const limiter = getLimiter(limit, window);
    if (!limiter) return next();
    const user = ctx.user;
    const key = user ? `${identifier}:${user.id}` : `${identifier}:anon`;
    const result = await limiter.limit(key);
    if (!result.success) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded for ${identifier}. Try again shortly.`,
      });
    }
    return next();
  });
}
