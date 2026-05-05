/**
 * Vitest global setup.
 *
 * Provides default test-only env vars for modules that perform lazy env
 * validation (e.g. `@/lib/extract/env`). We deliberately do NOT set
 * `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` here — many
 * suites rely on `getRedis()` returning `null` when those are missing
 * to bypass real Redis calls. The extract route tests provide their
 * own mocks for `getRedis`, so they don't need real values either.
 *
 * The `extract/env` module is mocked at the route-test level (where it
 * matters); other suites that don't import it are unaffected.
 */

const TEST_ENV_DEFAULTS: Record<string, string> = {
  GEMINI_API_KEY: "test-gemini-key",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

for (const [k, v] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (!process.env[k]) process.env[k] = v;
}
