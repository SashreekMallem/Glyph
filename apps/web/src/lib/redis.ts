/**
 * Shared Upstash Redis client.
 *
 * Returns `null` if env vars are missing so local dev / unit tests don't
 * have to spin up Redis. Callers MUST handle `null` (typically by treating
 * the absence of Redis as "no mutex available" and either failing closed or
 * proceeding without coordination — depending on their needs).
 */

import { Redis } from "@upstash/redis";

let cached: Redis | null = null;
let cacheKey: string | null = null;

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const k = `${url}::${token.slice(0, 8)}`;
  if (cached && cacheKey === k) return cached;
  cached = new Redis({ url, token });
  cacheKey = k;
  return cached;
}

/** Lua: DEL key only if its value matches the supplied token. */
export const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
