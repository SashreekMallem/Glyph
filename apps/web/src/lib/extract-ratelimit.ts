/**
 * Dedicated rate limiter for POST /api/v1/extract.
 *
 * 1000 requests/day per API key id. Returns null (no-op) when Upstash
 * env vars are missing so local dev works without Redis; the route
 * handler logs a warning in that case.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let cached: Ratelimit | null = null;
let cacheSource: string | null = null;

export function getExtractLimiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const src = `${url}::${token.slice(0, 8)}`;
  if (cached && cacheSource === src) return cached;
  const redis = new Redis({ url, token });
  cached = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(1000, "1 d"),
    analytics: true,
    prefix: "glyph:extract",
  });
  cacheSource = src;
  return cached;
}
