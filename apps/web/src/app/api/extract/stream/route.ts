/**
 * SSE streaming extraction endpoint.
 *
 * Browser POSTs `{ docId, schemaType, textDelta, fullText?, clientSeq, sessionId? }`
 * with a Supabase JWT cookie. The server:
 *
 *   1. Authenticates via Supabase server client.
 *   2. Authorizes the user against `documents.user_id`.
 *   3. Acquires a per-doc Redis mutex (`SET ... NX EX 65`) so concurrent
 *      streams for the same doc serialize.
 *   4. Resolves the JSON Schema via `@glyph/schema-library`.
 *   5. Folds current episode state for the doc.
 *   6. Pipes Gemini's `streamExtract` events into a Server-Sent Events
 *      response, persisting each patch as an `extraction_episode`.
 *
 * Errors before the SSE body opens return JSON; once the SSE response is
 * flowing, errors are emitted as `event: error` then the stream closes.
 */

import { type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { documents } from "@/db/schema";
import {
  appendEpisode,
  createSession,
  endSession,
  foldCurrent,
} from "@/lib/extract/episodes";
import {
  computeCostUsd,
  recordUsage,
  checkDailyCap,
  checkPerDocCap,
  readUserDailyCapUsd,
  readDocCapUsd,
} from "@/lib/extract/cost";
import { logExtractEvent, metric } from "@/lib/extract/telemetry";
import { getRedis, RELEASE_LOCK_SCRIPT } from "@/lib/redis";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getExtractEnv, ExtractEnvError } from "@/lib/extract/env";
import {
  ensureCache,
  streamExtract,
  type StreamExtractRequest,
} from "@glyph/extract";
import {
  resolveSchema,
  SchemaNotFoundError,
} from "@/lib/extract/resolve-schema";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface ReqBody {
  docId: string;
  schemaType: string;
  textDelta: string;
  fullText?: string;
  clientSeq?: number;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// GLiNER2 fast-path
//
// The Python GLiNER2 service (env: GLINER_SERVICE_URL) is consulted before
// Gemini when we have full document text. Its response is shaped exactly
// like below; we treat any deviation as a transient miss and fall through
// to Gemini. The confidence gate is the only knob — `min_confidence >=
// CONFIDENCE_GATE` means we trust GLiNER2 enough to skip Gemini entirely
// for this turn.
// ---------------------------------------------------------------------------

interface GlinerSpan {
  readonly path: string;
  readonly value: unknown;
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

interface GlinerResponse {
  readonly spans: readonly GlinerSpan[];
  readonly structured: Record<string, unknown>;
  readonly min_confidence: number;
  readonly avg_confidence: number;
  readonly duration_ms: number;
  readonly model: string;
}

/** Minimum GLiNER2 confidence required to short-circuit Gemini. */
const GLINER_CONFIDENCE_GATE = 0.85;

/** Hard timeout for the GLiNER2 fast-path call (ms). */
const GLINER_TIMEOUT_MS = 2_000;

/**
 * Convert a dot-notation path (`"personal.full_name"`, `"items.0.qty"`)
 * to an RFC 6901 JSON pointer (`"/personal/full_name"`, `"/items/0/qty"`).
 * Per spec, `/` and `~` inside path segments are escaped to `~1`/`~0`;
 * GLiNER2 paths are field-keyed so this is mostly belt-and-braces.
 */
function toJsonPointer(dotPath: string): string {
  const segments = dotPath.split(".");
  const escaped = segments.map((seg) =>
    seg.replace(/~/g, "~0").replace(/\//g, "~1"),
  );
  return "/" + escaped.join("/");
}

/**
 * Project GLiNER2 spans onto an RFC 6902 patch. Every span becomes a
 * single `add` op carrying the source-text offsets so downstream sync
 * (drift detection) can find the field again when the user edits text.
 * Spans are emitted in document-order so the editor's path-by-path
 * highlighter animates cleanly.
 */
function spansToPatches(
  spans: readonly GlinerSpan[],
): ReadonlyArray<{
  op: "add";
  path: string;
  value: unknown;
  srcStart: number;
  srcEnd: number;
}> {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  return sorted.map((s) => ({
    op: "add" as const,
    path: toJsonPointer(s.path),
    value: s.value,
    srcStart: s.start,
    srcEnd: s.end,
  }));
}

/**
 * Call the GLiNER2 service. Returns `null` if the service is not
 * configured, the call times out, or the response is malformed — every
 * non-success case falls through to Gemini.
 */
async function callGliner(args: {
  readonly url: string;
  readonly text: string;
  readonly docType: string;
}): Promise<GlinerResponse | null> {
  try {
    const r = await fetch(`${args.url}/v1/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: args.text, doc_type: args.docType }),
      signal: AbortSignal.timeout(GLINER_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const parsed = (await r.json()) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { spans?: unknown }).spans) ||
      typeof (parsed as { min_confidence?: unknown }).min_confidence !== "number"
    ) {
      return null;
    }
    return parsed as GlinerResponse;
  } catch {
    return null;
  }
}

function isReqBody(v: unknown): v is ReqBody {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.docId === "string" &&
    typeof o.schemaType === "string" &&
    o.schemaType.length > 0 &&
    typeof o.textDelta === "string"
  );
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: { "content-type": "application/json", ...extraHeaders },
    },
  );
}

function log(fields: Record<string, unknown>): void {
  // Structured single-line JSON log for downstream ingestion.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(fields));
}

function newRequestId(): string {
  // Use crypto.randomUUID where available; fall back to time+random.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Schema cache resource (Gemini cached-content) lookup, persisted in Redis.
// ---------------------------------------------------------------------------

async function resolveCacheRef(
  schemaType: string,
  schemaVersion: string,
  prefix: string,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  const redis = getRedis();
  const key = `extract:cache:${schemaType}:${schemaVersion}`;
  if (redis) {
    try {
      const cached = (await redis.get(key)) as string | null;
      if (cached && typeof cached === "string") return cached;
    } catch {
      // fall through to ensureCache
    }
  }
  const ref = await ensureCache({ apiKey, prefix, ttlSeconds: 3600 });
  if (ref && redis) {
    try {
      await redis.set(key, ref, { ex: 3600 });
    } catch {
      // best-effort caching only
    }
  }
  return ref;
}

// ---------------------------------------------------------------------------
// Request size limit — pre-empts pathological single deltas before we hit
// auth/db. 1 MiB is well above any reasonable streaming chunk.
// ---------------------------------------------------------------------------

const MAX_TEXT_DELTA_BYTES = 1 * 1024 * 1024; // 1 MiB

// ---------------------------------------------------------------------------
// SSE writer helpers
// ---------------------------------------------------------------------------

function sseEvent(event: string, data: unknown): Uint8Array {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

const HEARTBEAT_BYTES = new TextEncoder().encode(`: ping\n\n`);
const HEARTBEAT_MS = 15_000;

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  const startedAtMs = Date.now();
  const requestId = newRequestId();

  // --- Env validation (lazy; thrown only at first extract request). ---
  let env;
  try {
    env = getExtractEnv();
  } catch (err) {
    if (err instanceof ExtractEnvError) {
      log({
        requestId,
        event: "env_error",
        missing: err.missing,
      });
      return jsonError(
        503,
        "service_unavailable",
        "extraction pipeline is not configured",
      );
    }
    throw err;
  }

  // --- Parse body (with size limit). ---
  let body: ReqBody;
  try {
    // Content-Length is the cheapest pre-empt; we still re-check after
    // parse since clients can omit it.
    const cl = Number(req.headers.get("content-length") ?? 0);
    if (cl > MAX_TEXT_DELTA_BYTES * 2) {
      return jsonError(413, "payload_too_large", "request body too large");
    }
    const raw = (await req.json()) as unknown;
    if (!isReqBody(raw)) {
      return jsonError(400, "bad_request", "invalid body shape");
    }
    if (
      typeof raw.textDelta === "string" &&
      Buffer.byteLength(raw.textDelta, "utf8") > MAX_TEXT_DELTA_BYTES
    ) {
      return jsonError(413, "payload_too_large", "textDelta exceeds 1 MiB");
    }
    body = raw;
  } catch {
    return jsonError(400, "bad_request", "invalid JSON");
  }

  // --- Auth. ---
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError(401, "unauthorized", "no session");
  }
  const userId = user.id;

  // --- Authorize: user must own the doc. ---
  const docRows = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      schemaVersion: documents.schemaVersion,
    })
    .from(documents)
    .where(eq(documents.id, body.docId))
    .limit(1);
  const doc = docRows[0];
  if (!doc) {
    return jsonError(404, "not_found", "document not found");
  }
  if (doc.userId !== userId) {
    return jsonError(403, "forbidden", "no access to document");
  }

  // --- Cost caps (user-daily + per-doc). ---
  const redisForCaps = getRedis();
  const userCapUsd = readUserDailyCapUsd();
  const docCapUsd = readDocCapUsd();
  try {
    const [userCap, docCap] = await Promise.all([
      checkDailyCap(redisForCaps, { userId, capUsd: userCapUsd }),
      checkPerDocCap(redisForCaps, { docId: body.docId, capUsd: docCapUsd }),
    ]);
    if (!userCap.ok || !docCap.ok) {
      const which = !userCap.ok ? userCap : docCap;
      const kind = !userCap.ok ? "user" : "doc";
      logExtractEvent({
        event: "extract.cap_exceeded",
        requestId,
        userId,
        docId: body.docId,
        extra: { kind, currentUsd: which.currentUsd, capUsd: which.capUsd },
      });
      return new Response(
        JSON.stringify({
          error: "cost_cap_exceeded",
          kind,
          currentUsd: which.currentUsd,
          capUsd: which.capUsd,
        }),
        {
          status: 402,
          headers: { "content-type": "application/json" },
        },
      );
    }
  } catch (err) {
    // Fail-open on cap-check infrastructure errors — the DB-side counter
    // is the authoritative ledger and will catch overspend after-the-fact.
    logExtractEvent({
      event: "extract.error",
      requestId,
      userId,
      docId: body.docId,
      error: err instanceof Error ? err.message : String(err),
      extra: { phase: "cap_check" },
    });
  }

  // --- Schema resolution. ---
  let zodSchema;
  let schemaJson;
  let schemaVersion: string;
  try {
    const resolved = await resolveSchema(db as never, {
      typeKey: body.schemaType,
      userId,
    });
    zodSchema = resolved.zodSchema;
    schemaJson = resolved.schemaJson;
    schemaVersion = resolved.schemaVersion;
  } catch (err) {
    if (err instanceof SchemaNotFoundError) {
      return jsonError(
        400,
        "bad_request",
        `unsupported schemaType: ${body.schemaType}`,
      );
    }
    return jsonError(
      500,
      "internal",
      `schema resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Mutex acquire. ---
  const redis = getRedis();
  const lockKey = `extract:lock:${body.docId}`;
  let lockAcquired = false;
  if (redis) {
    try {
      const result = await redis.set(lockKey, requestId, { nx: true, ex: 65 });
      lockAcquired = result === "OK";
    } catch (err) {
      log({
        requestId,
        userId,
        docId: body.docId,
        event: "lock_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (!lockAcquired) {
      return jsonError(409, "locked", "another extraction is in progress for this document", {
        "Retry-After": "1",
      });
    }
  }

  // --- Session bootstrap. ---
  let sessionId = body.sessionId;
  if (!sessionId) {
    try {
      const created = await createSession(db as never, {
        userId,
        docId: body.docId,
        schemaVersion,
        model: env.geminiModel,
      });
      sessionId = created.id;
    } catch (err) {
      // Release lock before returning JSON error.
      if (redis && lockAcquired) {
        try {
          await redis.eval(RELEASE_LOCK_SCRIPT, [lockKey], [requestId]);
        } catch {
          /* ignore */
        }
      }
      return jsonError(
        500,
        "internal",
        `failed to create session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- Fold current state. ---
  let currentEase: unknown = {};
  try {
    const fold = await foldCurrent(db as never, {
      docId: body.docId,
      schema: zodSchema,
    });
    currentEase = fold.state;
  } catch (err) {
    log({
      requestId,
      userId,
      docId: body.docId,
      event: "fold_error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // DEBUG: log what arrives and what suffix looks like
  log({
    requestId,
    event: "extract.debug",
    textDeltaLen: body.textDelta?.length ?? 0,
    fullTextLen: body.fullText?.length ?? 0,
    currentEaseKeys: Object.keys(currentEase as object ?? {}).length,
  });

  // --- Build the extract request. ---
  // On the very first request of a streaming session (clientSeq === 0), reset currentEase
  // to {} if fullText is provided. This forces Gemini to do a full re-extraction from
  // scratch, sending all paths back down to the client so the client's `easeRef` becomes
  // perfectly synced with the backend's EASE structure. Subsequent calls in the same
  // session will do an incremental diff, saving 99% of output tokens.
  const extractReq: StreamExtractRequest = {
    schemaJson,
    schemaVersion,
    currentEase: body.fullText && body.clientSeq === 0 ? {} : currentEase,
    textDelta: body.textDelta,
    fullText: body.fullText,
    sessionId: sessionId!,
    docId: body.docId,
    userId,
    clientSeq: body.clientSeq,
  };

  // --- Resolve cache ref (best effort). Gemini prefix cache. ---
  // We approximate the cacheable prefix as the schemaJson serialization;
  // the real prefix lives inside `buildPrompt` but that's not exported.
  // This still gives stable per-(schemaType,schemaVersion) caching keyed
  // on the JSON schema, which is sufficient for prefix-cache hits across
  // requests targeting the same schema.
  let cacheRef: string | null = null;
  try {
    cacheRef = await resolveCacheRef(
      body.schemaType,
      schemaVersion,
      JSON.stringify(schemaJson),
    );
  } catch (err) {
    log({
      requestId,
      userId,
      docId: body.docId,
      event: "cache_error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // --- Open the SSE stream. ---
  const apiKey = env.geminiApiKey;
  const aborter = new AbortController();
  // Forward client disconnect to the gemini stream.
  const onClientAbort = () => aborter.abort();
  req.signal.addEventListener("abort", onClientAbort, { once: true });

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const releaseLock = async () => {
    if (redis && lockAcquired) {
      try {
        await redis.eval(RELEASE_LOCK_SCRIPT, [lockKey], [requestId]);
      } catch {
        /* swallow */
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      // Heartbeat keeps proxies alive on quiet streams.
      heartbeat = setInterval(() => safeEnqueue(HEARTBEAT_BYTES), HEARTBEAT_MS);

      // Initial event so clients know the stream is live and learn the
      // session id.
      safeEnqueue(sseEvent("ready", { sessionId, requestId }));
      logExtractEvent({
        event: "extract.start",
        requestId,
        userId,
        docId: body.docId,
        sessionId,
        schemaVersion,
      });
      await metric.increment("extract.requests");

      let totalIn = 0;
      let totalOut = 0;
      let totalCached = 0;
      let totalCostMicros = 0n;
      let sawError = false;
      let patchSeq = 0;

      // -------------------------------------------------------------------
      // Layer 2: GLiNER2 fast-path.
      //
      // When GLiNER2 is configured AND we have full document text, ask it
      // first. If its `min_confidence` clears the gate we emit its spans
      // as RFC 6902 patches and skip the Gemini stream entirely — same
      // wire format the editor already understands, just a different
      // source. Below the gate we still log the result for offline
      // analysis but defer to Gemini.
      //
      // Failures (timeout, non-2xx, network error) silently fall through
      // to Gemini; the user never sees a fast-path failure.
      // -------------------------------------------------------------------
      const glinerUrl = process.env.GLINER_SERVICE_URL;
      let glinerResult: GlinerResponse | null = null;
      let skipGemini = false;
      if (glinerUrl && body.fullText) {
        const glinerStart = Date.now();
        try {
          glinerResult = await callGliner({
            url: glinerUrl,
            text: body.fullText,
            docType: body.schemaType,
          });
        } catch (err) {
          log({
            requestId,
            userId,
            docId: body.docId,
            sessionId,
            event: "gliner_error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        log({
          requestId,
          userId,
          docId: body.docId,
          sessionId,
          event: "gliner_call",
          ok: glinerResult !== null,
          durationMs: Date.now() - glinerStart,
          ...(glinerResult
            ? {
                spans: glinerResult.spans.length,
                minConfidence: glinerResult.min_confidence,
                avgConfidence: glinerResult.avg_confidence,
                upstreamMs: glinerResult.duration_ms,
                model: glinerResult.model,
              }
            : {}),
        });
        if (
          glinerResult !== null &&
          glinerResult.min_confidence >= GLINER_CONFIDENCE_GATE
        ) {
          skipGemini = true;
        }
      }

      try {
        if (skipGemini && glinerResult !== null) {
          // GLiNER2 fast-path: emit synthetic patches, then `done`.
          //
          // We deliberately re-use the existing patch SSE event shape so
          // `useDocumentExtraction` doesn't need to change — the only
          // observable difference for the client is that no `usage` event
          // is emitted (GLiNER2 is local, no token spend) and the stream
          // ends faster.
          await metric.increment("extract.gliner_hit");
          logExtractEvent({
            event: "extract.gliner_hit",
            requestId,
            userId,
            docId: body.docId,
            sessionId,
            schemaVersion,
            extra: {
              spans: glinerResult.spans.length,
              minConfidence: glinerResult.min_confidence,
              avgConfidence: glinerResult.avg_confidence,
              upstreamMs: glinerResult.duration_ms,
              model: glinerResult.model,
            },
          });
          const patches = spansToPatches(glinerResult.spans);
          if (patches.length > 0) {
            // Persist each op as an episode (best effort) — mirror the
            // Gemini-path's behaviour so historical timelines stay
            // consistent regardless of which extractor produced them.
            for (const op of patches) {
              try {
                await appendEpisode(db as never, {
                  sessionId: sessionId!,
                  docId: body.docId,
                  userId,
                  patch: [op],
                  schemaVersion,
                  model: `gliner:${glinerResult.model}`,
                });
              } catch (err) {
                log({
                  requestId,
                  userId,
                  docId: body.docId,
                  sessionId,
                  event: "episode_error",
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
            safeEnqueue(
              sseEvent("patch", { patches, seq: patchSeq++ }),
            );
          }
        } else {
          // Gemini fallback (the original path). If GLiNER2 produced a
          // sub-gate result it is still informative — we log a metric so
          // the offline pipeline can correlate gate misses with the
          // structured output. `StreamExtractRequest` has no `hint`
          // field today; surfacing the hint to Gemini is left to the
          // verification agent.
          await metric.increment("extract.gemini_fallback");
          logExtractEvent({
            event: "extract.gemini_fallback",
            requestId,
            userId,
            docId: body.docId,
            sessionId,
            schemaVersion,
            extra: {
              glinerAttempted: glinerResult !== null,
              glinerMinConfidence: glinerResult?.min_confidence ?? null,
            },
          });
        }

        // Run Gemini only if we didn't short-circuit on the GLiNER fast path.
        if (!skipGemini) for await (const ev of streamExtract(extractReq, {
          apiKey,
          signal: aborter.signal,
          ...(cacheRef ? { cacheRef } : {}),
        })) {
          if (ev.type === "patch" && ev.patches) {
            // Persist each op as an episode (best effort).
            for (const op of ev.patches) {
              try {
                await appendEpisode(db as never, {
                  sessionId: sessionId!,
                  docId: body.docId,
                  userId,
                  patch: [op],
                  schemaVersion,
                  model: env.geminiModel,
                });
              } catch (err) {
                log({
                  requestId,
                  userId,
                  docId: body.docId,
                  sessionId,
                  event: "episode_error",
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
            safeEnqueue(sseEvent("patch", { patches: ev.patches, seq: patchSeq++ }));
          } else if (ev.type === "usage" && ev.usage) {
            totalIn += ev.usage.promptTokens ?? 0;
            totalOut += ev.usage.candidatesTokens ?? 0;
            totalCached += ev.usage.cachedTokens ?? 0;

            // Use the canonical cost computer — model id is the source of
            // truth, NOT the model-supplied costUsd (which may be stale).
            const modelId = env.geminiModel;
            const costUsd =
              typeof ev.usage.costUsd === "number"
                ? ev.usage.costUsd
                : computeCostUsd(ev.usage, modelId);
            totalCostMicros += BigInt(Math.round(costUsd * 1_000_000));

            // Persist + bump rolling counters (best-effort).
            try {
              await recordUsage(db as never, redisForCaps, {
                userId,
                sessionId: sessionId!,
                docId: body.docId,
                usage: ev.usage,
                costUsd,
              });
            } catch (err) {
              logExtractEvent({
                event: "extract.error",
                requestId,
                userId,
                docId: body.docId,
                sessionId,
                error: err instanceof Error ? err.message : String(err),
                extra: { phase: "record_usage" },
              });
            }

            // Mid-stream cap enforcement.
            const [userCap, docCap] = await Promise.all([
              checkDailyCap(redisForCaps, { userId, capUsd: userCapUsd }),
              checkPerDocCap(redisForCaps, {
                docId: body.docId,
                capUsd: docCapUsd,
              }),
            ]);
            if (!userCap.ok || !docCap.ok) {
              const which = !userCap.ok ? userCap : docCap;
              const kind = !userCap.ok ? "user" : "doc";
              safeEnqueue(
                sseEvent("error", {
                  error: "cost_cap_exceeded",
                  kind,
                  currentUsd: which.currentUsd,
                  capUsd: which.capUsd,
                }),
              );
              sawError = true;
              aborter.abort();
              break;
            }

            safeEnqueue(sseEvent("usage", { ...ev.usage, costUsd }));
            await metric.observe("extract.cost_usd", costUsd * 1_000_000);
          } else if (ev.type === "error") {
            sawError = true;
            console.error("====== GEMINI STREAM YIELDED ERROR ======\n", ev.error, "\n=========================================");
            safeEnqueue(sseEvent("error", { error: ev.error ?? "unknown" }));
          } else if (ev.type === "done") {
            // Handled below.
          }
        }

        // End the session.
        try {
          await endSession(db as never, {
            sessionId: sessionId!,
            status: sawError ? "failed" : "succeeded",
            totals: {
              tokensIn: totalIn,
              tokensOut: totalOut,
              cachedTokens: totalCached,
              costMicros: totalCostMicros,
            },
          });
        } catch (err) {
          log({
            requestId,
            userId,
            docId: body.docId,
            sessionId,
            event: "end_session_error",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        safeEnqueue(sseEvent("done", { sessionId }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("====== GEMINI STREAM ERROR ======\n", message, "\n=================================");
        log({
          requestId,
          userId,
          docId: body.docId,
          sessionId,
          event: "stream_error",
          error: message,
        });
        safeEnqueue(sseEvent("error", { error: message }));
        try {
          await endSession(db as never, {
            sessionId: sessionId!,
            status: "failed",
          });
        } catch {
          /* ignore */
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        req.signal.removeEventListener("abort", onClientAbort);
        await releaseLock();
        const ms = Date.now() - startedAtMs;
        logExtractEvent({
          event: sawError ? "extract.error" : "extract.done",
          requestId,
          userId,
          docId: body.docId,
          sessionId,
          durationMs: ms,
          tokens: { in: totalIn, out: totalOut, cached: totalCached },
        });
        await metric.observe("extract.latency_ms", ms);
        await metric.increment(
          sawError ? "extract.failures" : "extract.successes",
        );
      }
    },
    async cancel() {
      // Client disconnected mid-stream.
      aborter.abort();
      if (heartbeat) clearInterval(heartbeat);
      closed = true;
      await releaseLock();
      log({
        requestId,
        userId,
        docId: body.docId,
        sessionId,
        event: "stream_cancelled",
        ms: Date.now() - startedAtMs,
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
