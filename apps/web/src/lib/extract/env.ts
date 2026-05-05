/**
 * Lazy environment validation for the extraction pipeline.
 *
 * Returns a typed config snapshot the first time `getExtractEnv()` is
 * called and caches the result. Module import is intentionally cheap and
 * side-effect free — routes that never run extraction (e.g. static pages,
 * unrelated APIs) must not crash because `GEMINI_API_KEY` is unset on
 * their cold-start path.
 *
 * Required vars (throw on first call if missing):
 *   - GEMINI_API_KEY            Google Gemini API key
 *   - UPSTASH_REDIS_REST_URL    Upstash Redis REST endpoint
 *   - UPSTASH_REDIS_REST_TOKEN  Upstash Redis REST token
 *   - DATABASE_URL              Postgres connection string
 *   - SUPABASE_SERVICE_ROLE_KEY Supabase service role JWT (server-only)
 *
 * Optional vars (defaulted):
 *   - GEMINI_MODEL              default: "gemini-2.5-flash-lite"
 *   - EXTRACT_USER_DAILY_USD_CAP default: 1.0
 *   - EXTRACT_DOC_USD_CAP        default: 0.10
 */

export interface ExtractEnv {
  readonly geminiApiKey: string;
  readonly upstashRedisRestUrl: string;
  readonly upstashRedisRestToken: string;
  readonly databaseUrl: string;
  readonly supabaseServiceRoleKey: string;
  readonly geminiModel: string;
  readonly userDailyUsdCap: number;
  readonly docUsdCap: number;
}

export class ExtractEnvError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `Extract pipeline misconfigured: missing required env vars: ${missing.join(", ")}`,
    );
    this.name = "ExtractEnvError";
    this.missing = missing;
  }
}

let cached: ExtractEnv | null = null;

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Returns the validated extract env. First call validates required vars and
 * throws `ExtractEnvError` if any are missing; subsequent calls return the
 * cached snapshot. Tests can call `_resetExtractEnv()` to clear.
 */
export function getExtractEnv(): ExtractEnv {
  if (cached) return cached;

  const required = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v || v.length === 0)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new ExtractEnvError(missing);
  }

  cached = {
    geminiApiKey: required.GEMINI_API_KEY!,
    upstashRedisRestUrl: required.UPSTASH_REDIS_REST_URL!,
    upstashRedisRestToken: required.UPSTASH_REDIS_REST_TOKEN!,
    databaseUrl: required.DATABASE_URL!,
    supabaseServiceRoleKey: required.SUPABASE_SERVICE_ROLE_KEY!,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
    userDailyUsdCap: readNumber("EXTRACT_USER_DAILY_USD_CAP", 1.0),
    docUsdCap: readNumber("EXTRACT_DOC_USD_CAP", 0.1),
  };

  return cached;
}

/** Test-only: clear the cached snapshot. */
export function _resetExtractEnv(): void {
  cached = null;
}
