/**
 * Real-time extraction plugin.
 *
 * Watches ProseMirror doc changes, computes a text delta against the last
 * sent snapshot, ships it through `ExtractClient` to the SSE route, and
 * folds the streamed RFC-6902 patches into a local EASE state held in the
 * plugin's own state slice.
 *
 * Lifecycle:
 *   - `init`         — empty EASE, no session, no streams in flight.
 *   - `apply`        — on doc change: compute delta, enqueue on the
 *                      client, advance `lastSentText` + `clientSeq`.
 *                    — on `extract$patch` meta: fold the RFC-6902 patch
 *                      into `state.ease` (idempotent on stale seq).
 *                    — on other meta: update session/error/streaming flags.
 *   - `view`         — instantiates the client, wires its callbacks to
 *                      dispatch metas back into the plugin, tears down on
 *                      `destroy()`.
 *
 * The plugin works as a passive state holder when `docId`/`schemaType` are
 * missing — handy for tests and for the empty-doc bootstrap before the
 * caller knows the document id.
 */

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { z } from "zod";

import { applyPatches } from "@glyph/extract/client";
import type { RFC6902Patch, TokenUsage } from "@glyph/extract/client";

import { ExtractClient } from "@/lib/extract/client";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ExtractPluginOptions {
  readonly docId?: string;
  readonly schemaType?: string;
  readonly schemaJson?: unknown;
  readonly schemaVersion?: string;
  readonly zodSchema?: z.ZodTypeAny;
  readonly getAuthToken?: () => string | null | Promise<string | null>;
  readonly debounceMs?: number;
  readonly onStateChange?: (ease: object) => void;
  readonly onError?: (err: Error) => void;
}

export interface ExtractPluginState {
  readonly ease: object;
  readonly schemaVersion: string;
  readonly sessionId: string | null;
  readonly lastSentText: string;
  readonly clientSeq: number;
  readonly isStreaming: boolean;
  readonly lastError?: string;
  readonly lastUsage?: TokenUsage;
}

export const extractPluginKey = new PluginKey<ExtractPluginState>(
  "glyph-extract",
);

// Meta keys the plugin understands. Keep them stringly-typed so callers can
// dispatch without importing internal symbols.
const META_PATCH = "extract$patch";
const META_SESSION = "extract$session";
const META_ERROR = "extract$error";
const META_DONE = "extract$done";
const META_USAGE = "extract$usage";
const META_STREAMING = "extract$streaming";

// ---------------------------------------------------------------------------
// Delta encoding
// ---------------------------------------------------------------------------

/**
 * Compute a compact delta between `prev` and `next`. We trim equal prefix +
 * suffix and emit either:
 *   - empty string when nothing changed,
 *   - the trailing slice when the change is a pure append, or
 *   - `[[REPLACE@<offset>:<oldLen>]]<newSlice>` for arbitrary edits.
 *
 * The receiving server only needs `textDelta` to be unambiguous w.r.t. the
 * previously sent text; this format does that without a full diff library.
 */
export function computeDelta(prev: string, next: string): string {
  if (prev === next) return "";

  // Common prefix
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p++;

  // Common suffix (not overlapping the prefix region)
  let s = 0;
  while (
    s < max - p &&
    prev.charCodeAt(prev.length - 1 - s) ===
      next.charCodeAt(next.length - 1 - s)
  ) {
    s++;
  }

  const oldLen = prev.length - p - s;
  const newSlice = next.slice(p, next.length - s);

  // Pure append at end of prev
  if (p === prev.length && s === 0) return newSlice;

  return `[[REPLACE@${p}:${oldLen}]]${newSlice}`;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function extractPlugin(options: ExtractPluginOptions = {}): Plugin {
  const debounceMs = options.debounceMs ?? 300;

  return new Plugin<ExtractPluginState>({
    key: extractPluginKey,
    state: {
      init(): ExtractPluginState {
        return {
          ease: {},
          schemaVersion: options.schemaVersion ?? "",
          sessionId: null,
          lastSentText: "",
          clientSeq: 0,
          isStreaming: false,
        };
      },

      apply(tr, prev, _oldState, newState): ExtractPluginState {
        // Meta-driven updates take priority — they never touch the doc.
        const patchMeta = tr.getMeta(META_PATCH) as
          | { patches: RFC6902Patch; seq: number }
          | undefined;
        if (patchMeta) {
          // Idempotency: drop patches for stale seq numbers.
          if (patchMeta.seq < prev.clientSeq - 1) {
            return prev;
          }
          const result = applyPatches(
            prev.ease,
            patchMeta.patches,
            options.zodSchema,
          );
          const nextEase =
            (result.state as object | null | undefined) ?? prev.ease;
          return { ...prev, ease: nextEase, isStreaming: true };
        }

        const sessionMeta = tr.getMeta(META_SESSION) as string | undefined;
        if (sessionMeta) {
          return { ...prev, sessionId: sessionMeta };
        }

        const errorMeta = tr.getMeta(META_ERROR) as string | undefined;
        if (errorMeta !== undefined) {
          return { ...prev, lastError: errorMeta, isStreaming: false };
        }

        if (tr.getMeta(META_DONE)) {
          return { ...prev, isStreaming: false };
        }

        const usageMeta = tr.getMeta(META_USAGE) as TokenUsage | undefined;
        if (usageMeta) {
          return { ...prev, lastUsage: usageMeta };
        }

        const streamingMeta = tr.getMeta(META_STREAMING) as
          | boolean
          | undefined;
        if (typeof streamingMeta === "boolean") {
          return { ...prev, isStreaming: streamingMeta };
        }

        // Doc-change path.
        if (!tr.docChanged) return prev;

        const fullText = newState.doc.textBetween(
          0,
          newState.doc.content.size,
          "\n",
        );
        if (fullText === prev.lastSentText) return prev;

        return {
          ...prev,
          lastSentText: fullText,
          clientSeq: prev.clientSeq + 1,
        };
      },
    },

    view(view: EditorView) {
      // No client without addressing info — plugin still works as a state
      // holder, exposing `ease: {}` and friends.
      if (!options.docId || !options.schemaType) {
        return {
          update() {},
          destroy() {},
        };
      }

      const client = new ExtractClient({
        docId: options.docId,
        schemaType: options.schemaType,
        debounceMs,
        getAuthToken: options.getAuthToken,
        onPatch: (patches: RFC6902Patch, seq: number) => {
          const tr = view.state.tr.setMeta(META_PATCH, { patches, seq });
          view.dispatch(tr);
          // Read state AFTER dispatch so we get the updated EASE.
          const next = extractPluginKey.getState(view.state);
          if (next && options.onStateChange) {
            options.onStateChange(next.ease);
          }
        },
        onUsage: (usage: TokenUsage) => {
          view.dispatch(view.state.tr.setMeta(META_USAGE, usage));
        },
        onError: (err: Error) => {
          view.dispatch(view.state.tr.setMeta(META_ERROR, err.message));
          if (options.onError) options.onError(err);
        },
        onDone: () => {
          view.dispatch(view.state.tr.setMeta(META_DONE, true));
        },
      });

      return {
        update(v: EditorView, prevState: EditorState) {
          if (v.state.doc.eq(prevState.doc)) return;
          const prevPlugin = extractPluginKey.getState(prevState);
          const nextPlugin = extractPluginKey.getState(v.state);
          if (!prevPlugin || !nextPlugin) return;
          if (nextPlugin.lastSentText === prevPlugin.lastSentText) return;
          const delta = computeDelta(
            prevPlugin.lastSentText,
            nextPlugin.lastSentText,
          );
          if (!delta) return;
          if (!nextPlugin.isStreaming) {
            v.dispatch(v.state.tr.setMeta(META_STREAMING, true));
          }
          client.enqueueDelta(delta, nextPlugin.lastSentText);
        },
        destroy() {
          client.close();
        },
      };
    },
  });
}
