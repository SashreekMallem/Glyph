/**
 * Cost computation, recording, and cap enforcement for the extraction
 * pipeline.
 *
 * Pricing is the SINGLE SOURCE OF TRUTH for all extraction-cost math.
 * To add a new model, append a row to `MODEL_PRICING` — every caller
 * (route, telemetry, tests) reads from this table.
 *
 * All amounts are stored as integer micro-USD (USD * 1e6) to avoid
 * floating-point drift across rolling counters and DB sums. The public
 * surface accepts/returns USD `number` for ergonomic call sites; convert
 * at the boundary only.
 *
 * Redis keys (all TTL'd, no unbounded growth):
 *   extract:user-cost:{userId}:{YYYY-MM-DD}   TTL ~36h (date-keyed; resets at UTC midnight)
 *   extract:doc-cost:{docId}                  TTL ~7d
 *
 * Daily caps reset at UTC midnight by virtue of the date-suffixed key.
 */

import type { Redis } from "@upstash/redis";
import { eq, sql } from "drizzle-orm";

import { extractionSessions } from "@/db/schema";
import type { TokenUsage } from "@glyph/extract";

// ---------------------------------------------------------------------------
// Pricing table — single source of truth.
// ---------------------------------------------------------------------------

/** USD per 1M tokens. */
export interface ModelPricing {
  readonly inputPerM: number;
  readonly cachedInputPerM: number;
  readonly outputPerM: number;
}

/**
 * Gemini 2.5 Flash Lite pricing (approx, public list price).
 * Update this table when Google adjusts prices — every other module
 * pulls from here.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash-lite": {
    inputPerM: 0.1,
    cachedInputPerM: 0.025,
    outputPerM: 0.4,
  },
  // Alias kept for legacy callers that wrote "gemini-3-flash-lite".
  "gemini-3-flash-lite": {
    inputPerM: 0.1,
    cachedInputPerM: 0.025,
    outputPerM: 0.4,
  },
} as const;

/** Fallback used when an unknown model id is supplied. */
export const DEFAULT_MODEL: keyof typeof MODEL_PRICING = "gemini-2.5-flash-lite";

// ---------------------------------------------------------------------------
// USD <-> micros conversion
// ---------------------------------------------------------------------------

const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.round(usd * MICROS_PER_USD));
}

export function microsToUsd(micros: bigint | number | string): number {
  const b = typeof micros === "bigint" ? micros : BigInt(micros);
  return Number(b) / MICROS_PER_USD;
}

// ---------------------------------------------------------------------------
// computeCostUsd
// ---------------------------------------------------------------------------

/**
 * Compute extraction cost in USD given a TokenUsage record and model id.
 * Cached input tokens are subtracted from the prompt tokens before applying
 * the (more expensive) input rate, then re-added at the cached rate.
 *
 * If the model id is unknown the default Flash Lite rates are used and
 * the caller should ideally upstream-log the miss; we don't throw because
 * cost should never block a request.
 */
export function computeCostUsd(usage: TokenUsage, model: string): number {
  const pricing =
    MODEL_PRICING[model] ?? (MODEL_PRICING[DEFAULT_MODEL] as ModelPricing);
  const safeNum = (n: number | undefined): number =>
    Number.isFinite(n) && (n as number) > 0 ? (n as number) : 0;
  const cached = safeNum(usage.cachedTokens);
  const prompt = safeNum(usage.promptTokens);
  const billablePrompt = Math.max(0, prompt - cached);
  const output = safeNum(usage.candidatesTokens);

  const cost =
    (billablePrompt / 1_000_000) * pricing.inputPerM +
    (cached / 1_000_000) * pricing.cachedInputPerM +
    (output / 1_000_000) * pricing.outputPerM;

  // Round to integer micros worth of precision then back to USD to avoid
  // exposing float artifacts to callers.
  return Math.round(cost * MICROS_PER_USD) / MICROS_PER_USD;
}

// ---------------------------------------------------------------------------
// Redis keys
// ---------------------------------------------------------------------------

/** Returns YYYY-MM-DD in UTC for the given Date (default: now). */
export function utcDateKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function userCostKey(userId: string, date: string = utcDateKey()): string {
  return `extract:user-cost:${userId}:${date}`;
}

export function docCostKey(docId: string): string {
  return `extract:doc-cost:${docId}`;
}

const USER_COST_TTL_S = 60 * 60 * 36; // 36h: covers any timezone observer.
const DOC_COST_TTL_S = 60 * 60 * 24 * 7; // 7d.

// ---------------------------------------------------------------------------
// recordUsage
// ---------------------------------------------------------------------------

/**
 * Minimal Drizzle-shaped handle. Structural so test mocks need not
 * satisfy the full surface.
 */
export interface CostDB {
  update: (table: unknown) => {
    set: (row: unknown) => {
      where: (cond: unknown) => Promise<unknown>;
    };
  };
}

export interface RecordUsageArgs {
  readonly userId: string;
  readonly sessionId: string;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly docId?: string;
}

/**
 * Increment the per-session totals row AND the rolling Redis counters.
 *
 * DB write is authoritative for cost reporting / billing. Redis counters
 * are best-effort, used only for fast cap checks. A Redis failure must
 * not roll back the DB write — we swallow Redis errors and rely on the
 * cap check to fail-open in that case (the alternative — failing closed
 * — would let a flaky Upstash node DOS extraction).
 */
export async function recordUsage(
  db: CostDB,
  redis: Redis | null,
  args: RecordUsageArgs,
): Promise<void> {
  const costMicros = usdToMicros(args.costUsd);

  // --- DB increment (authoritative). ---
  await db
    .update(extractionSessions)
    .set({
      totalTokensIn: sql`${extractionSessions.totalTokensIn} + ${args.usage.promptTokens ?? 0}`,
      totalTokensOut: sql`${extractionSessions.totalTokensOut} + ${args.usage.candidatesTokens ?? 0}`,
      totalCachedTokens: sql`${extractionSessions.totalCachedTokens} + ${args.usage.cachedTokens ?? 0}`,
      totalCostMicros: sql`${extractionSessions.totalCostMicros} + ${costMicros.toString()}::bigint`,
    })
    .where(eq(extractionSessions.id, args.sessionId));

  // --- Redis rolling counters (best-effort). ---
  if (!redis || costMicros === 0n) return;

  const userKey = userCostKey(args.userId);
  try {
    await redis.incrby(userKey, Number(costMicros));
    await redis.expire(userKey, USER_COST_TTL_S);
  } catch {
    /* swallow */
  }

  if (args.docId) {
    const dKey = docCostKey(args.docId);
    try {
      await redis.incrby(dKey, Number(costMicros));
      await redis.expire(dKey, DOC_COST_TTL_S);
    } catch {
      /* swallow */
    }
  }
}

// ---------------------------------------------------------------------------
// Cap checks
// ---------------------------------------------------------------------------

export interface CapResult {
  readonly ok: boolean;
  readonly currentUsd: number;
  readonly capUsd: number;
}

async function readCounter(redis: Redis, key: string): Promise<bigint> {
  const raw = (await redis.get(key)) as number | string | null;
  if (raw === null || raw === undefined) return 0n;
  if (typeof raw === "number") return BigInt(Math.round(raw));
  // Upstash REST sometimes returns numeric strings.
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export async function checkDailyCap(
  redis: Redis | null,
  args: { userId: string; capUsd: number },
): Promise<CapResult> {
  if (!redis || !Number.isFinite(args.capUsd) || args.capUsd <= 0) {
    return { ok: true, currentUsd: 0, capUsd: args.capUsd };
  }
  let currentMicros = 0n;
  try {
    currentMicros = await readCounter(redis, userCostKey(args.userId));
  } catch {
    // Fail-open: never DOS extraction on a flaky cache.
    return { ok: true, currentUsd: 0, capUsd: args.capUsd };
  }
  const currentUsd = microsToUsd(currentMicros);
  return { ok: currentUsd < args.capUsd, currentUsd, capUsd: args.capUsd };
}

export async function checkPerDocCap(
  redis: Redis | null,
  args: { docId: string; capUsd: number },
): Promise<CapResult> {
  if (!redis || !Number.isFinite(args.capUsd) || args.capUsd <= 0) {
    return { ok: true, currentUsd: 0, capUsd: args.capUsd };
  }
  let currentMicros = 0n;
  try {
    currentMicros = await readCounter(redis, docCostKey(args.docId));
  } catch {
    return { ok: true, currentUsd: 0, capUsd: args.capUsd };
  }
  const currentUsd = microsToUsd(currentMicros);
  return { ok: currentUsd < args.capUsd, currentUsd, capUsd: args.capUsd };
}

// ---------------------------------------------------------------------------
// Env helpers — single place to read cap config so route + tests agree.
// ---------------------------------------------------------------------------

export const DEFAULT_USER_DAILY_CAP_USD = 1.0;
export const DEFAULT_DOC_CAP_USD = 0.1;

export function readUserDailyCapUsd(): number {
  const v = Number(process.env.EXTRACT_USER_DAILY_USD_CAP);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_USER_DAILY_CAP_USD;
}

export function readDocCapUsd(): number {
  const v = Number(process.env.EXTRACT_DOC_USD_CAP);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DOC_CAP_USD;
}
