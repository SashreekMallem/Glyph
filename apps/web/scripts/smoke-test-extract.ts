/**
 * Live smoke test for the extraction pipeline.
 *
 * Exercises @glyph/extract against the real Gemini API end-to-end:
 *   1. Resolves a built-in schema (resume).
 *   2. Builds a prompt with stable prefix.
 *   3. Streams an extraction over a small synthetic document.
 *   4. Folds patches with applyPatches into final EASE state.
 *   5. Decodes EASE → plain JSON.
 *   6. Reports tokens, cost (USD), latency, and any errors.
 *
 * Reads GEMINI_API_KEY + GEMINI_MODEL from apps/web/.env.local.
 * Does NOT touch the database — pure in-memory exercise.
 *
 * Run:   pnpm tsx scripts/smoke-test-extract.ts
 */

import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { getSchema, toJsonSchema } from "@glyph/schema-library";
import {
  streamExtract,
  applyPatches,
  decode,
  type ExtractEvent,
  type RFC6902Op,
} from "@glyph/extract";
import { computeCostUsd } from "../src/lib/extract/cost";

// Minimal .env.local loader (no dotenv dep).
function loadEnv(path: string) {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (process.env[k!] === undefined) {
        process.env[k!] = v!.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* ignore */
  }
}
loadEnv(resolve(__dirname, "../.env.local"));

const SAMPLE_TEXT = `
Jane Doe
Senior Software Engineer
jane.doe@example.com  |  +1-555-0142  |  San Francisco, CA

Experience
- Acme Corp — Staff Engineer (2021-Present): led the migration of a 200-service
  monolith to a service-mesh architecture; cut p95 latency by 38%.
- Globex — Senior Engineer (2017-2021): built the realtime analytics pipeline
  that ingests 4M events/sec.

Education
- Stanford University — B.S. Computer Science, 2015
`.trim();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";

  if (!apiKey || apiKey.includes("PLACEHOLDER")) {
    console.error(
      "ERROR: GEMINI_API_KEY not set (or still placeholder). Update apps/web/.env.local first.",
    );
    process.exit(2);
  }

  const zodSchema = getSchema("resume");
  const schemaJson = toJsonSchema(zodSchema);

  console.log(JSON.stringify({ phase: "start", model, textLen: SAMPLE_TEXT.length }));

  const t0 = performance.now();
  const patches: RFC6902Op[] = [];
  let usage: ExtractEvent | null = null;
  let lastError: string | null = null;
  let firstPatchMs: number | null = null;

  const generator = streamExtract(
    {
      schemaJson: schemaJson as unknown as Record<string, unknown>,
      schemaVersion: "builtin-v1-resume",
      currentEase: {},
      textDelta: SAMPLE_TEXT,
      fullText: SAMPLE_TEXT,
      sessionId: "smoke-test-session",
      docId: "smoke-test-doc",
      userId: "smoke-test-user",
    } as never,
    { apiKey, model, maxRetries: 2 } as never,
  );

  for await (const event of generator) {
    if (event.type === "patch") {
      const ops = (event as { patches?: RFC6902Op[] }).patches ?? [];
      for (const op of ops) {
        patches.push(op);
        if (firstPatchMs === null) firstPatchMs = performance.now() - t0;
      }
    } else if (event.type === "usage") {
      usage = event;
    } else if (event.type === "error") {
      lastError = JSON.stringify((event as { error: unknown }).error);
    }
  }

  const totalMs = performance.now() - t0;

  // Fold and decode
  const fold = applyPatches({}, patches, zodSchema);
  const decoded = decode(fold.state as never, zodSchema);

  const tokenUsage = (usage as { usage?: { promptTokens: number; cachedTokens: number; candidatesTokens: number; totalTokens: number } } | null)?.usage;
  const costUsd = tokenUsage
    ? computeCostUsd(tokenUsage as never, model)
    : 0;

  console.log(
    JSON.stringify(
      {
        phase: "done",
        ok: lastError === null && patches.length > 0,
        totalMs: Math.round(totalMs),
        firstPatchMs: firstPatchMs !== null ? Math.round(firstPatchMs) : null,
        patchCount: patches.length,
        foldErrors: fold.errors.length,
        usage: tokenUsage ?? null,
        costUsd,
        error: lastError,
      },
      null,
      2,
    ),
  );

  console.log("\nDecoded JSON sample (first 500 chars):");
  console.log(JSON.stringify(decoded, null, 2).slice(0, 500));

  process.exit(lastError === null && patches.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
