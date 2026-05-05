// Gemini Flash Lite client — streaming extraction with prefix caching,
// lenient streaming JSON parsing, retries, and abort support.
//
// Yields RFC 6902 patch ops as they materialise from the streaming token
// buffer (parsed leniently so partial JSON is non-fatal), plus terminal
// usage / error events.

import { GoogleGenAI } from "@google/genai";
import { parsePartial } from "./lenient-parser";
import { buildPrompt } from "./prompt";
import type {
  ExtractRequest,
  ExtractEvent,
  RFC6902Op,
  TokenUsage,
} from "./types";

// TODO(model-id): Confirm exact Gemini 3 Flash Lite model id once GA.
// The user spec mentions `gemini-3-flash-lite`; current public id is
// `gemini-2.5-flash-lite`. Override via env or `opts.model`.
export const GEMINI_MODEL =
  (typeof process !== "undefined" && process.env?.GEMINI_MODEL) ||
  "gemini-2.5-flash-lite";

/**
 * Historically we sent a `responseSchema` to Gemini to grammar-constrain the
 * output. The Vertex-style schema dialect Gemini accepts does not support
 * `oneOf` / `anyOf` cleanly across versions, and crucially it cannot express
 * "value can be ANY JSON value" — declaring `value: STRING` causes the model
 * to stringify nested objects, which then fails to fold as RFC 6902 patches.
 *
 * We now rely solely on `responseMimeType: "application/json"` plus a strict
 * system prompt (see `prompt.ts`). The constant is still exported so older
 * tests / callers that reference it keep type-checking, but it is NOT sent
 * in the request config.
 */
export const RFC6902_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      op: { type: "STRING" },
      path: { type: "STRING" },
      // `value` and `from` intentionally omitted — Gemini's schema dialect
      // cannot represent "any JSON value", and constraining `value` to STRING
      // breaks structured output for object/array values.
    },
    required: ["op", "path"],
  },
} as const;

export interface StreamExtractOpts {
  apiKey: string;
  signal?: AbortSignal;
  model?: string;
  maxRetries?: number;
  /** Optional cached-content resource name (returned by `ensureCache`). */
  cacheRef?: string;
}

export interface EnsureCacheOpts {
  apiKey: string;
  prefix: string;
  ttlSeconds?: number;
  model?: string;
}

interface ErrorWithCode extends Error {
  status?: number;
  code?: number;
  retryable?: boolean;
}

const RETRY_DELAYS_MS = [250, 500, 1000];

function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e.status === "number") return e.status as number;
  if (typeof e.code === "number") return e.code as number;
  // Some SDKs wrap message like "[429] ..."
  const msg = typeof e.message === "string" ? (e.message as string) : "";
  const m = msg.match(/\b(\d{3})\b/);
  if (m) return Number(m[1]);
  return undefined;
}

function isRetryable(err: unknown): boolean {
  const code = getStatusCode(err);
  if (code === 429 || code === 503) return true;
  // Network errors with no status are also retryable.
  if (code === undefined) {
    const msg = err instanceof Error ? err.message : String(err);
    return /network|timeout|fetch/i.test(msg);
  }
  return false;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

/**
 * Create a Gemini cached-content resource for a stable prefix. Falls back to
 * `null` if the prefix is too short / not cacheable — caller should treat
 * that as "send inline".
 */
export async function ensureCache(
  opts: EnsureCacheOpts,
): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = opts.model ?? GEMINI_MODEL;
  const ttl = opts.ttlSeconds ?? 600;
  try {
    const created = await ai.caches.create({
      model,
      config: {
        contents: [{ role: "user", parts: [{ text: opts.prefix }] }],
        ttl: `${ttl}s`,
      },
    } as unknown as Parameters<typeof ai.caches.create>[0]);
    const name =
      (created as { name?: string })?.name ??
      (created as { resourceName?: string })?.resourceName ??
      null;
    return name;
  } catch {
    // Prefix too short, quota error, etc. — caller falls back to inline.
    return null;
  }
}

function diffPatchOps(prev: RFC6902Op[], next: unknown): RFC6902Op[] {
  if (!Array.isArray(next)) return [];
  // Only consider entries up to `next.length - 1` if last is potentially
  // partial. Lenient parser drops in-progress objects, so all entries it
  // returns are "complete enough" to surface — but to be safe we still gate
  // on having both `op` and `path`. Source spans (srcStart/srcEnd) are
  // forwarded as-is when both are integers; otherwise stripped so consumers
  // see well-typed, validated optional fields.
  const out: RFC6902Op[] = [];
  for (let i = prev.length; i < next.length; i++) {
    const item = next[i];
    if (!item || typeof item !== "object") continue;
    const op = (item as { op?: unknown }).op;
    const path = (item as { path?: unknown }).path;
    if (typeof op !== "string" || typeof path !== "string") continue;
    const rec = item as Record<string, unknown>;
    const sStart = rec.srcStart;
    const sEnd = rec.srcEnd;
    if (
      Number.isInteger(sStart) &&
      Number.isInteger(sEnd) &&
      (sStart as number) >= 0 &&
      (sEnd as number) >= (sStart as number)
    ) {
      // valid span — keep as-is
    } else if ("srcStart" in rec || "srcEnd" in rec) {
      delete rec.srcStart;
      delete rec.srcEnd;
    }
    out.push(item as RFC6902Op);
  }
  return out;
}

function extractUsage(meta: unknown): TokenUsage {
  const m = (meta ?? {}) as Record<string, number | undefined>;
  return {
    promptTokens: m.promptTokenCount ?? 0,
    cachedTokens: m.cachedContentTokenCount ?? 0,
    candidatesTokens: m.candidatesTokenCount ?? 0,
    totalTokens: m.totalTokenCount ?? 0,
  };
}

/**
 * Stream a structured extraction from Gemini, yielding incremental patch
 * events as the model generates RFC 6902 ops.
 */
/**
 * Subset of `ExtractRequest` actually consumed by `streamExtract`. The SSE
 * route / client use the full `ExtractRequest`; `streamExtract` only needs
 * the prompt-building fields plus identifiers for logging.
 */
export type StreamExtractRequest = Pick<
  ExtractRequest,
  | "schemaJson"
  | "schemaVersion"
  | "currentEase"
  | "textDelta"
  | "fullText"
  | "sessionId"
  | "examples"
> &
  Partial<Pick<ExtractRequest, "docId" | "userId" | "clientSeq">> & {
    readonly onlyPaths?: readonly string[];
  };

export async function* streamExtract(
  request: StreamExtractRequest,
  opts: StreamExtractOpts,
): AsyncGenerator<ExtractEvent> {
  const maxRetries = opts.maxRetries ?? 3;
  const model = opts.model ?? GEMINI_MODEL;

  const built = buildPrompt({
    schemaJson: request.schemaJson,
    schemaVersion: request.schemaVersion,
    currentEase: request.currentEase,
    textDelta: request.textDelta,
    fullText: request.fullText,
    sessionId: request.sessionId,
    examples: request.examples,
    onlyPaths: request.onlyPaths,
  });

  // Compose the request contents. If `cacheRef` is given, the cacheable
  // prefix is on the server, so we only send the variable suffix.
  const cacheableText = built.prefix;
  const variableText = built.suffix;

  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  if (!opts.cacheRef && cacheableText.length > 0) {
    contents.push({ role: "user", parts: [{ text: cacheableText }] });
  }
  if (variableText.length > 0) {
    contents.push({ role: "user", parts: [{ text: variableText }] });
  }
  if (contents.length === 0) {
    // Always send something so the model has at least one user turn.
    contents.push({ role: "user", parts: [{ text: "" }] });
  }

  const config: Record<string, unknown> = {
    responseMimeType: "application/json",
    // NOTE: `responseSchema` deliberately not sent. See comment on
    // RFC6902_RESPONSE_SCHEMA — Gemini's schema dialect can't express
    // "value: any JSON value", and constraining it breaks the pipeline.
  };
  if (opts.cacheRef) {
    config.cachedContent = opts.cacheRef;
  }
  if (opts.signal) {
    config.abortSignal = opts.signal;
  }

  const params = { model, contents, config };

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  // ---- Retry loop wrapping `generateContentStream` initial call. ----
  let stream: AsyncGenerator<unknown> | null = null;
  let attempt = 0;
  while (true) {
    if (opts.signal?.aborted) {
      yield {
        type: "error",
        error: "aborted",
      } as ExtractEvent;
      return;
    }
    try {
      stream = (await ai.models.generateContentStream(
        params as unknown as Parameters<
          typeof ai.models.generateContentStream
        >[0],
      )) as AsyncGenerator<unknown>;
      break;
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: "error", error: "aborted" } as ExtractEvent;
        return;
      }
      const code = getStatusCode(err);
      const retryable = isRetryable(err);
      if (!retryable || attempt >= maxRetries) {
        yield {
          type: "error",
          error:
            (err instanceof Error ? err.message : String(err)) +
            (code !== undefined ? ` (code=${code})` : ""),
        } as ExtractEvent;
        return;
      }
      const delay =
        RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 1000;
      attempt++;
      try {
        await sleep(delay, opts.signal);
      } catch {
        yield { type: "error", error: "aborted" } as ExtractEvent;
        return;
      }
    }
  }

  // ---- Streaming consumption + lenient parse. ----
  let buffer = "";
  let emitted: RFC6902Op[] = [];
  let lastUsage: TokenUsage | undefined;
  try {
    for await (const chunk of stream as AsyncGenerator<unknown>) {
      if (opts.signal?.aborted) {
        yield { type: "error", error: "aborted" } as ExtractEvent;
        return;
      }
      const c = chunk as {
        text?: string | (() => string);
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: unknown;
      };

      // Gemini SDK exposes `.text` as a getter returning the chunk text;
      // tests may set it as a plain string. Also fall back to walking
      // candidate parts.
      let piece = "";
      if (typeof c.text === "string") {
        piece = c.text;
      } else if (typeof c.text === "function") {
        try {
          piece = (c.text as () => string)() ?? "";
        } catch {
          piece = "";
        }
      } else if (Array.isArray(c.candidates)) {
        for (const cand of c.candidates) {
          const parts = cand?.content?.parts;
          if (!parts) continue;
          for (const p of parts) {
            if (typeof p?.text === "string") piece += p.text;
          }
        }
      }
      if (c.usageMetadata) {
        lastUsage = extractUsage(c.usageMetadata);
      }
      if (!piece) continue;
      buffer += piece;

      const parsed = parsePartial(buffer);
      const newOps = diffPatchOps(emitted, parsed.value);
      if (newOps.length > 0) {
        for (const op of newOps) {
          yield {
            type: "patch",
            patches: [op],
          } as ExtractEvent;
        }
        emitted = emitted.concat(newOps);
      }
    }
  } catch (err) {
    if (isAbortError(err) || opts.signal?.aborted) {
      yield { type: "error", error: "aborted" } as ExtractEvent;
      return;
    }
    yield {
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    } as ExtractEvent;
    return;
  }

  // Final pass: lenient parse may have a complete result now; flush any
  // tail ops that weren't surfaced mid-stream.
  const finalParsed = parsePartial(buffer);
  const tail = diffPatchOps(emitted, finalParsed.value);
  for (const op of tail) {
    yield { type: "patch", patches: [op] } as ExtractEvent;
  }

  yield {
    type: "usage",
    usage: lastUsage ?? {
      promptTokens: 0,
      cachedTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0,
    },
  } as ExtractEvent;
  yield { type: "done" } as ExtractEvent;
}
