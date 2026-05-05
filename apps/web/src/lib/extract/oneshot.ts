/**
 * One-shot LLM extraction helper.
 *
 * Wraps `streamExtract` (from `@glyph/extract`) with the schema resolver,
 * episode-store persistence, and final EASE decode so callers that want
 * a synchronous "text in, JSON out" surface (the legacy v1 endpoint, the
 * MCP `structure_document` tool, etc.) don't have to wire the streaming
 * pipeline themselves.
 *
 * Streaming consumers (`/api/extract/stream`) keep using `streamExtract`
 * directly — this helper is for non-streaming callers only.
 *
 * Persistence is opt-in: pass a real `db` handle and `docId`/`sessionId`
 * to record a session + episode. Pass `db: undefined` for stateless
 * extraction (e.g. the MCP tool that has no document of record).
 */

import type { z } from "zod";

import {
  applyPatches,
  decode,
  regionsFromOps,
  streamExtract,
  type FieldRegions,
  type RFC6902Op,
  type RFC6902Patch,
  type StreamExtractRequest,
  type TokenUsage,
} from "@glyph/extract";

import {
  appendEpisode,
  createSession,
  endSession,
  type EpisodeDB,
} from "@/lib/extract/episodes";
import {
  resolveSchema,
  SchemaNotFoundError,
  type ResolveSchemaDB,
} from "@/lib/extract/resolve-schema";
import { computeCostUsd } from "@/lib/extract/cost";
import { getExtractEnv, ExtractEnvError } from "@/lib/extract/env";

export { SchemaNotFoundError };

export interface ExtractOneShotArgs {
  /** Raw document text to extract from. */
  readonly text: string;
  /** Built-in document type (`contract` | `resume` | `invoice`) or a custom `documentTypes.key`. */
  readonly typeKey: string;
  /** Tenant id — required for custom-type isolation; pass the API-key owner / Supabase user. */
  readonly userId: string;
  /**
   * Drizzle-ish handle. Must satisfy both `ResolveSchemaDB` (for schema
   * lookup) and — when `docId` is provided — `EpisodeDB` (for session
   * persistence). Pass `undefined` to skip every DB roundtrip; the
   * caller is then responsible for any auditing it cares about.
   */
  readonly db?: (ResolveSchemaDB & EpisodeDB) | undefined;
  /**
   * When set, an `extraction_session` + per-patch `extraction_episode`
   * rows are written. When omitted, the helper is purely stateless.
   */
  readonly docId?: string;
  /** Override the default Gemini API key source (`process.env.GEMINI_API_KEY`). */
  readonly apiKey?: string;
  /** Override the model used for the session row. */
  readonly model?: string;
  /** Cancel mid-extraction. */
  readonly signal?: AbortSignal;
  /**
   * Targeted re-extraction: when set, the model is instructed to emit
   * ops only for these dot-notation paths. Used by the self-healing-sync
   * pipeline to refresh just the fields that drifted.
   */
  readonly onlyPaths?: readonly string[];
}

export interface ExtractOneShotResult {
  /** Final, schema-shaped JSON (EASE-decoded). */
  readonly json: unknown;
  /** All RFC 6902 ops emitted by the model, in order. */
  readonly episodes: RFC6902Patch;
  /** Aggregate token usage from the Gemini response. */
  readonly usage: TokenUsage;
  /** USD cost estimate, if computable; `null` until Wave 5 lands the cost helper. */
  readonly costUsd: number | null;
  /** The schema version used (echoed for the caller's logs). */
  readonly schemaVersion: string;
  /** Session id when persistence was enabled, otherwise `null`. */
  readonly sessionId: string | null;
  /**
   * Per-leaf source regions (dot-notation path → `[start, end)`),
   * aggregated last-writer-wins from `srcStart`/`srcEnd` carried on each
   * emitted op. Used by the self-healing-sync pipeline to fingerprint
   * each field's source span. Empty `{}` if the model emitted no spans.
   */
  readonly regions: FieldRegions;
}

export class OneShotExtractError extends Error {
  readonly code: "stream_error" | "aborted";
  constructor(code: "stream_error" | "aborted", message: string) {
    super(message);
    this.name = "OneShotExtractError";
    this.code = code;
  }
}

const SYNTHETIC_SESSION = "oneshot-session";
const SYNTHETIC_DOC = "oneshot-doc";

function resolveApiKey(explicit: string | undefined): string {
  if (explicit && explicit.length > 0) return explicit;
  // Try the validated env first; fall back to raw process.env so callers
  // running in environments where only GEMINI_API_KEY is set (no Redis,
  // no Supabase — e.g. unit tests) still get a key without ExtractEnvError.
  try {
    return getExtractEnv().geminiApiKey;
  } catch (err) {
    if (!(err instanceof ExtractEnvError)) throw err;
    const raw =
      typeof process !== "undefined"
        ? (process.env?.GEMINI_API_KEY ?? process.env?.GOOGLE_API_KEY)
        : undefined;
    return raw ?? "";
  }
}

/**
 * Run a single extraction round-trip. See `ExtractOneShotArgs` /
 * `ExtractOneShotResult` for the contract.
 *
 * Errors are surfaced two ways:
 *   - `SchemaNotFoundError` for unknown `typeKey` (re-thrown from the resolver).
 *   - `OneShotExtractError` for `streamExtract` errors / aborts.
 */
export async function extractOneShot(
  args: ExtractOneShotArgs,
): Promise<ExtractOneShotResult> {
  const { text, typeKey, userId, db, docId, signal } = args;

  // 1. Resolve schema (tenant-isolated for custom types).
  const resolved = await resolveSchema(
    // resolveSchema only touches the DB on the custom-type path; for
    // built-ins (contract/resume/invoice) we can pass a stub.
    (db ?? STUB_RESOLVE_DB) as ResolveSchemaDB,
    { typeKey, userId },
  );

  // 2. (Optional) open a persisted session.
  let sessionId: string | null = null;
  const persist = db !== undefined && docId !== undefined;
  if (persist) {
    const created = await createSession(db as EpisodeDB, {
      userId,
      docId: docId!,
      schemaVersion: resolved.schemaVersion,
      model: args.model,
    });
    sessionId = created.id;
  }

  // 3. Drive the streamer to completion, collecting patches + usage.
  const apiKey = resolveApiKey(args.apiKey);
  const req: StreamExtractRequest = {
    schemaJson: resolved.schemaJson,
    schemaVersion: resolved.schemaVersion,
    currentEase: {},
    textDelta: text,
    fullText: text,
    sessionId: sessionId ?? SYNTHETIC_SESSION,
    docId: docId ?? SYNTHETIC_DOC,
    userId,
    onlyPaths: args.onlyPaths,
  };

  const collected: RFC6902Op[] = [];
  let usage: TokenUsage = {
    promptTokens: 0,
    cachedTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0,
  };
  let firstError: string | null = null;

  try {
    for await (const ev of streamExtract(req, { apiKey, signal })) {
      if (ev.type === "patch" && ev.patches) {
        for (const op of ev.patches) {
          collected.push(op);
          if (persist && sessionId) {
            try {
              await appendEpisode(db as EpisodeDB, {
                sessionId,
                docId: docId!,
                userId,
                patch: [op],
                schemaVersion: resolved.schemaVersion,
                model: args.model,
              });
            } catch {
              // Persistence is best-effort; the caller still gets the
              // in-memory result. Swallow rather than abort the stream.
            }
          }
        }
      } else if (ev.type === "usage" && ev.usage) {
        usage = ev.usage;
      } else if (ev.type === "error") {
        firstError = ev.error ?? "unknown";
        // streamExtract terminates after an error event; loop will exit.
      }
      // "done" needs no handling.
    }
  } finally {
    if (persist && sessionId) {
      try {
        await endSession(db as EpisodeDB, {
          sessionId,
          status: firstError ? "failed" : "succeeded",
          totals: {
            tokensIn: usage.promptTokens,
            tokensOut: usage.candidatesTokens,
            cachedTokens: usage.cachedTokens,
          },
        });
      } catch {
        // ignore
      }
    }
  }

  if (firstError) {
    const code = firstError === "aborted" ? "aborted" : "stream_error";
    throw new OneShotExtractError(code, firstError);
  }

  // 4. Fold patches → final EASE state, then decode for the caller.
  const fold = applyPatches({}, collected, resolved.zodSchema);
  const json = decode(fold.state, resolved.zodSchema as z.ZodTypeAny);

  // Prefer the model-reported cost if Gemini surfaced one; otherwise
  // compute via the central pricing table. Returns null only if both
  // paths fail (e.g. unknown model + no cost from the API).
  const model =
    args.model ??
    (typeof process !== "undefined"
      ? process.env?.GEMINI_MODEL
      : undefined) ??
    "gemini-2.5-flash-lite";
  let costUsd: number | null = null;
  if (typeof usage.costUsd === "number") {
    costUsd = usage.costUsd;
  } else {
    try {
      const computed = computeCostUsd(usage, model);
      costUsd = Number.isFinite(computed) ? computed : null;
    } catch {
      costUsd = null;
    }
  }

  return {
    json,
    episodes: collected,
    usage,
    costUsd,
    schemaVersion: resolved.schemaVersion,
    sessionId,
    regions: regionsFromOps(collected),
  };
}

// ---------------------------------------------------------------------------
// Internal: a stub DB that throws on any query. Used as the fallback when
// the caller passed `db: undefined` AND the resolver needs a custom-type
// lookup. Built-ins never hit this path.
// ---------------------------------------------------------------------------

const STUB_RESOLVE_DB: ResolveSchemaDB = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          throw new Error(
            "extractOneShot: db handle required for custom typeKeys",
          );
        },
      }),
    }),
  }),
};
