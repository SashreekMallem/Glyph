/**
 * Prose-to-field extractor plugin.
 *
 * Watches the doc for `paragraph` nodes, debounces, and asks the
 * in-browser classifier (Transformers.js Web Worker) to tell us what
 * each paragraph is. If the classifier returns a label with confidence
 * at/above the threshold, we replace the paragraph with a `field` node
 * whose `path` comes from a caller-supplied label→path mapping.
 *
 * Unclassified paragraphs stay as paragraphs — the user keeps writing,
 * we keep trying. Paragraphs shorter than `minChars` are skipped.
 *
 * Labels never get sent for a paragraph more than once per
 * (position, text) tuple — if the user edits a paragraph we re-classify
 * it. This is tracked via a lightweight `seen` set keyed by
 * `${from}:${text.slice(0, 40)}`.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

import { editorSchema } from "../schema";

export type ExtractorReport = {
  readonly from: number;
  readonly to: number;
  readonly label: string;
  readonly path: string;
  readonly confidence: number;
};

export interface ExtractorOptions {
  readonly documentType: string;
  /** Map of human label → JSONPath to assign once classified. */
  readonly labelToPath: Record<string, string>;
  /** The list of labels to send to the classifier as candidates. */
  readonly candidateLabels: readonly string[];
  /** Minimum characters before a paragraph is worth classifying. */
  readonly minChars?: number;
  /** Debounce after last keystroke, ms. */
  readonly debounceMs?: number;
  /** Callback invoked every time a paragraph is promoted to a field. */
  readonly onExtract?: (report: ExtractorReport) => void;
}

export const extractorKey = new PluginKey("glyph-extractor");

type PendingRequest = {
  readonly requestId: string;
  readonly text: string;
};

/**
 * Generate a request id we can match in the worker callback. We also
 * use this to avoid promoting paragraphs that have moved/changed by the
 * time the async classify call resolves.
 */
function makeRequestId(from: number, text: string): string {
  return `${from}:${text.slice(0, 40)}`;
}

export function extractorPlugin(opts: ExtractorOptions): Plugin {
  const {
    documentType,
    labelToPath,
    candidateLabels,
    minChars = 4,
    debounceMs = 1500,
    onExtract,
  } = opts;

  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const pending = new Map<string, PendingRequest>();
  const seen = new Set<string>();

  const ensureWorker = (view: EditorView): Worker | null => {
    if (worker) return worker;
    if (typeof window === "undefined") return null;
    try {
      worker = new Worker(
        new URL("../../../workers/classifier.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("message", (ev) => {
        if (disposed) return;
        const data = ev.data as {
          type: string;
          fieldId?: string;
          label?: string;
          confidence?: number;
          reason?: string;
          message?: string;
        };
        if (data.type === "ready") {
          console.log("[extractor] classifier ready");
        } else if (data.type === "progress") {
          console.log("[extractor] classifier loading:", data);
        } else if (data.type === "result" && data.fieldId && data.label) {
          console.log("[extractor] classified:", data.fieldId, "→", data.label, data.confidence);
          const req = pending.get(data.fieldId);
          pending.delete(data.fieldId);
          if (!req) return;
          const path = labelToPath[data.label];
          if (!path) {
            console.log("[extractor] no path for label:", data.label, "available:", Object.keys(labelToPath));
            return;
          }
          promote(view, req, data.label, path, data.confidence ?? 0);
        } else if (data.type === "skipped") {
          console.log("[extractor] skipped:", data.fieldId, "reason:", data.reason);
          if (data.fieldId) pending.delete(data.fieldId);
        } else if (data.type === "error") {
          console.error("[extractor] error:", data.fieldId, data.message);
          if (data.fieldId) pending.delete(data.fieldId);
        }
      });
    } catch {
      worker = null;
    }
    return worker;
  };

  const promote = (
    view: EditorView,
    req: PendingRequest,
    label: string,
    path: string,
    confidence: number,
  ): void => {
    // Re-locate the paragraph: walk the current doc and find the
    // paragraph whose text still matches. If the user has heavily
    // edited, we bail — the next debounced pass will catch up.
    const doc = view.state.doc;
    let foundFrom = -1;
    let foundTo = -1;
    doc.descendants((node, pos) => {
      if (foundFrom !== -1) return false;
      if (node.type.name !== "paragraph") return true;
      if (node.textContent.trim() === req.text.trim()) {
        foundFrom = pos;
        foundTo = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    if (foundFrom === -1) return;

    const fieldNode = editorSchema.nodes.field.create(
      { path, label, confidence },
      req.text.length > 0 ? editorSchema.text(req.text) : null,
    );
    const transaction = view.state.tr.replaceWith(
      foundFrom,
      foundTo,
      fieldNode,
    );
    transaction.setMeta(extractorKey, { promoted: true });
    view.dispatch(transaction);

    if (onExtract)
      onExtract({
        from: foundFrom,
        to: foundFrom + fieldNode.nodeSize,
        label,
        path,
        confidence,
      });
  };

  const scan = (view: EditorView): void => {
    if (disposed) return;
    const w = ensureWorker(view);
    if (!w) {
      console.log("[extractor] worker failed to load");
      return;
    }
    let count = 0;
    view.state.doc.descendants((node: PMNode, pos: number) => {
      if (node.type.name !== "paragraph") return true;
      const text = node.textContent.trim();
      if (text.length < minChars) return false;
      const requestId = makeRequestId(pos, text);
      if (seen.has(requestId)) return false;
      if (pending.has(requestId)) return false;
      seen.add(requestId);
      pending.set(requestId, { requestId, text });
      count++;
      console.log("[extractor] sending to classifier:", requestId.slice(0, 40), "labels:", candidateLabels.length);
      w.postMessage({
        type: "classify",
        fieldId: requestId,
        text,
        documentType,
        candidateLabels,
      });
      return false;
    });
    if (count === 0) {
      console.log("[extractor] no paragraphs to scan (or all seen)");
    }
  };

  return new Plugin({
    key: extractorKey,
    view(view) {
      // Fire once shortly after mount in case the doc is pre-populated.
      const bootTimer = setTimeout(() => scan(view), 400);
      return {
        update(view, prevState) {
          if (disposed) return;
          if (view.state.doc.eq(prevState.doc)) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => scan(view), debounceMs);
        },
        destroy() {
          disposed = true;
          clearTimeout(bootTimer);
          if (timer !== null) clearTimeout(timer);
          if (worker) {
            worker.terminate();
            worker = null;
          }
          pending.clear();
          seen.clear();
        },
      };
    },
  });
}
