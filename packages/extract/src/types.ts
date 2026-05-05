import type { z } from "zod";

/**
 * Optional source-text offsets carried alongside an op. Populated by the
 * model when emitting per-leaf ops; consumed by the self-healing-sync
 * pipeline to fingerprint each field's source span.
 *
 * Offsets are 0-indexed character positions into the `fullText` /
 * `textDelta` the model received. Half-open: `[srcStart, srcEnd)`.
 */
export interface SourceSpan {
  srcStart: number;
  srcEnd: number;
}

export type RFC6902Op =
  | ({ op: "add"; path: string; value: unknown } & Partial<SourceSpan>)
  | ({ op: "remove"; path: string } & Partial<SourceSpan>)
  | ({ op: "replace"; path: string; value: unknown } & Partial<SourceSpan>)
  | ({ op: "move"; from: string; path: string } & Partial<SourceSpan>)
  | ({ op: "copy"; from: string; path: string } & Partial<SourceSpan>)
  | ({ op: "test"; path: string; value: unknown } & Partial<SourceSpan>);

export type RFC6902Patch = RFC6902Op[];

/**
 * Canonical request shape used end-to-end by the extraction pipeline:
 * `buildPrompt` (prompt.ts), `streamExtract` (gemini.ts), the SSE route,
 * and the client. All optional fields are genuinely optional — required
 * ones must be present at the call site.
 */
export interface ExtractRequest {
  /** JSON Schema (or any JSON-serialisable schema descriptor). */
  schemaJson: unknown;
  /** Schema version string — bumping invalidates the prefix cache. */
  schemaVersion: string;
  /**
   * Legacy/optional schema-type identifier used by the SchemaResolver
   * registry. Kept for back-compat; prompt building uses `schemaJson`
   * directly.
   */
  schemaType?: string;
  /** Current EASE-encoded state the model should patch. */
  currentEase: unknown;
  /** Newly observed text since the last turn. */
  textDelta: string;
  /** Optional full document text (truncated from the end at prompt build). */
  fullText?: string;
  /** Session id — included in suffix only (does NOT affect cache key). */
  sessionId: string;
  /** Document id — used by the SSE route / persistence layer. */
  docId: string;
  /** User id — used by the SSE route / auth layer. */
  userId: string;
  /** Monotonic client sequence for ordering / dedupe. */
  clientSeq?: number;
  /** Optional override for the few-shot examples block. */
  examples?: unknown[];
}

export interface TokenUsage {
  promptTokens: number;
  cachedTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  /** Optional cost estimate in USD. */
  costUsd?: number;
}

export interface ExtractEvent {
  type: "patch" | "usage" | "error" | "done";
  seq?: number;
  patches?: RFC6902Patch;
  usage?: TokenUsage;
  error?: string;
}

export type SchemaResolver = (schemaType: string) => z.ZodTypeAny | null;
