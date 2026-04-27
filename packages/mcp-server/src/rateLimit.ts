/**
 * Rate limiter.
 *
 * - In-memory token bucket for dev/test (always available).
 * - Optionally Upstash-backed via REST if env vars are configured (prod).
 *
 * Keyed by client identifier (typically an IP derived from x-forwarded-for).
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetMs: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
}

export interface TokenBucketOptions {
  /** Max tokens (burst). Default 100. */
  readonly capacity?: number;
  /** Refill period in ms. Default 60_000 (1 minute). */
  readonly refillIntervalMs?: number;
  /** Now provider — overridable for tests. */
  readonly now?: () => number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class InMemoryTokenBucketLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillIntervalMs: number;
  private readonly buckets = new Map<string, BucketState>();
  private readonly now: () => number;

  constructor(opts: TokenBucketOptions = {}) {
    this.capacity = opts.capacity ?? 100;
    this.refillIntervalMs = opts.refillIntervalMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  async check(key: string): Promise<RateLimitDecision> {
    const t = this.now();
    let state = this.buckets.get(key);
    if (state === undefined) {
      state = { tokens: this.capacity, lastRefill: t };
      this.buckets.set(key, state);
    }
    // Refill: tokens are fully restored once refillIntervalMs has elapsed
    // since the last refill (fixed-window token bucket, 100 req/min).
    const elapsed = t - state.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      const periods = Math.floor(elapsed / this.refillIntervalMs);
      state.tokens = Math.min(this.capacity, state.tokens + periods * this.capacity);
      state.lastRefill = state.lastRefill + periods * this.refillIntervalMs;
    }
    if (state.tokens <= 0) {
      const resetMs = Math.max(0, state.lastRefill + this.refillIntervalMs - t);
      return { allowed: false, remaining: 0, resetMs };
    }
    state.tokens -= 1;
    const resetMs = Math.max(0, state.lastRefill + this.refillIntervalMs - t);
    return { allowed: true, remaining: state.tokens, resetMs };
  }

  /** Test helper. */
  _size(): number {
    return this.buckets.size;
  }
}

/** Minimal Upstash REST client surface we depend on — keeps dep optional. */
export interface UpstashRestCaller {
  (command: readonly (string | number)[]): Promise<{ result: unknown }>;
}

export interface UpstashLimiterOptions {
  readonly call: UpstashRestCaller;
  readonly capacity?: number;
  readonly windowSeconds?: number;
  readonly prefix?: string;
}

/**
 * Upstash-backed fixed-window counter limiter.
 *
 * Uses INCR + EXPIRE so we don't need any deps beyond fetch — we just need
 * a caller that speaks Upstash's REST command array protocol. This keeps
 * this package free of `@upstash/redis` as a hard dep.
 */
export class UpstashFixedWindowLimiter implements RateLimiter {
  private readonly call: UpstashRestCaller;
  private readonly capacity: number;
  private readonly windowSeconds: number;
  private readonly prefix: string;

  constructor(opts: UpstashLimiterOptions) {
    this.call = opts.call;
    this.capacity = opts.capacity ?? 100;
    this.windowSeconds = opts.windowSeconds ?? 60;
    this.prefix = opts.prefix ?? 'glyph:mcp:rl';
  }

  async check(key: string): Promise<RateLimitDecision> {
    const window = Math.floor(Date.now() / 1000 / this.windowSeconds);
    const redisKey = `${this.prefix}:${key}:${window}`;
    const incrRes = await this.call(['INCR', redisKey]);
    const count = typeof incrRes.result === 'number' ? incrRes.result : Number(incrRes.result);
    if (!Number.isFinite(count)) {
      // Fail-open if Upstash returns garbage so we don't DOS ourselves.
      return { allowed: true, remaining: this.capacity, resetMs: this.windowSeconds * 1000 };
    }
    if (count === 1) {
      await this.call(['EXPIRE', redisKey, this.windowSeconds]);
    }
    const remaining = Math.max(0, this.capacity - count);
    const resetMs =
      (window + 1) * this.windowSeconds * 1000 - Date.now();
    return {
      allowed: count <= this.capacity,
      remaining,
      resetMs: Math.max(0, resetMs),
    };
  }
}

/**
 * Default factory: Upstash if env is configured, else in-memory.
 * Pass a custom `env` for testability.
 */
export function createDefaultLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (typeof url === 'string' && url.length > 0 && typeof token === 'string' && token.length > 0) {
    const call: UpstashRestCaller = async (cmd) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(cmd),
      });
      if (!res.ok) {
        throw new Error(`Upstash REST error: ${res.status}`);
      }
      const json = (await res.json()) as { result: unknown };
      return json;
    };
    return new UpstashFixedWindowLimiter({ call });
  }
  return new InMemoryTokenBucketLimiter();
}
