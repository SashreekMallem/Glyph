/**
 * GLiNER entity extraction plugin.
 *
 * Watches paragraphs, debounces, and sends each paragraph's text to the
 * GLiNER worker. The worker returns all entities detected in that text;
 * we keep one entry per (paragraph, entity) pair so the UI can render the
 * full current set without stale results piling up.
 *
 * When an entity is detected, we promote the paragraph to a `field` node
 * with the entity's path, label, and confidence so it gets serialized
 * to the backend JSON.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";

import { editorSchema } from "../schema";

export type GlinerEntity = {
  readonly text: string;
  readonly label: string;
  readonly confidence: number;
};

export type GlinerExtractReport = {
  readonly from: number;
  readonly to: number;
  readonly label: string;
  readonly path: string;
  readonly confidence: number;
  readonly text: string;
};

export interface GlinerExtractorOptions {
  readonly labelToPath: Record<string, string>;
  readonly candidateLabels: readonly string[];
  readonly minChars?: number;
  readonly debounceMs?: number;
  readonly onExtractUpdate?: (reports: readonly GlinerExtractReport[]) => void;
}

export const glinerExtractorKey = new PluginKey("glyph-gliner-extractor");

type PendingRequest = {
  readonly requestId: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
};

function makeRequestId(from: number, text: string): string {
  return `${from}:${text}`;
}

export function glinerExtractorPlugin(opts: GlinerExtractorOptions): Plugin {
  const {
    labelToPath,
    candidateLabels,
    minChars = 4,
    debounceMs = 1500,
    onExtractUpdate,
  } = opts;

  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const pending = new Map<string, PendingRequest>();
  const detections = new Map<number, GlinerExtractReport[]>();
  // Track which paragraphs have been promoted to field nodes
  const promoted = new Set<number>();

  const emitSnapshot = (): void => {
    const all: GlinerExtractReport[] = [];
    for (const list of detections.values()) all.push(...list);
    onExtractUpdate?.(all);
  };

  const promoteToField = (view: EditorView, from: number, report: GlinerExtractReport): void => {
    if (promoted.has(from)) return;

    const tr = view.state.tr;
    const node = view.state.doc.nodeAt(from);
    if (!node || node.type.name !== "paragraph") return;

    const to = from + node.nodeSize;
    const text = node.textContent;

    // Replace paragraph with field node
    const fieldNode = editorSchema.nodes.field.create(
      {
        path: report.path,
        label: report.label,
        confidence: report.confidence,
      },
      text.length > 0 ? editorSchema.text(text) : null,
    );

    tr.replaceWith(from, to, fieldNode);
    view.dispatch(tr);
    promoted.add(from);
  };

  const ensureWorker = (view: EditorView): Worker | null => {
    if (worker) return worker;
    if (typeof window === "undefined") return null;
    try {
      worker = new Worker(
        new URL("../../../workers/gliner.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("message", (ev) => {
        if (disposed) return;
        const data = ev.data as {
          type: string;
          requestId?: string;
          entities?: Array<{ text: string; label: string; confidence: number }>;
          message?: string;
        };

        if (data.type === "ready") {
          scan(view);
          return;
        }

        if (data.type === "result") {
          const requestId = data.requestId;
          if (!requestId) return;

          const req = pending.get(requestId);
          if (!req) return;
          pending.delete(requestId);

          const entities = data.entities ?? [];
          const reports: GlinerExtractReport[] = [];
          let topReport: GlinerExtractReport | null = null;

          for (const e of entities) {
            const path = labelToPath[e.label];
            if (!path) continue;
            const report: GlinerExtractReport = {
              from: req.from,
              to: req.to,
              label: e.label,
              path,
              confidence: e.confidence,
              text: e.text,
            };
            reports.push(report);
            // Track the highest-confidence report for promotion
            if (!topReport || e.confidence > topReport.confidence) {
              topReport = report;
            }
          }

          // Replace detections for this paragraph
          if (reports.length > 0) {
            detections.set(req.from, reports);
            // Promote paragraph to field with top-confidence entity
            if (topReport) {
              promoteToField(view, req.from, topReport);
            }
          } else {
            detections.delete(req.from);
          }
          emitSnapshot();
          return;
        }

        if (data.type === "error") {
          if (data.requestId) pending.delete(data.requestId);
          console.error("[gliner] extraction error:", data.message);
        }
      });

      worker.addEventListener("error", (err) => {
        console.error("[gliner] worker error:", err);
        worker = null;
      });
    } catch (err) {
      console.error("[gliner] worker init failed:", err);
      worker = null;
    }
    return worker;
  };

  const scan = (view: EditorView): void => {
    if (disposed) return;
    const w = ensureWorker(view);
    if (!w) return;

    const livePositions = new Set<number>();

    view.state.doc.descendants((node: PMNode, pos: number) => {
      if (node.type.name === "paragraph") {
        const text = node.textContent.trim();
        livePositions.add(pos);

        if (text.length < minChars) {
          if (detections.has(pos)) {
            detections.delete(pos);
          }
          return false;
        }

        const requestId = makeRequestId(pos, text);

        if (pending.has(requestId)) return false;

        // Drop stale pending requests at the same position with different text
        for (const [pid, p] of pending) {
          if (p.from === pos && pid !== requestId) pending.delete(pid);
        }

        const to = pos + node.nodeSize;
        pending.set(requestId, { requestId, text, from: pos, to });

        w.postMessage({
          type: "extract",
          requestId,
          text,
          entities: candidateLabels,
          threshold: 0.4,
        });
      }
      return true;
    });

    // Drop detections for paragraphs that no longer exist
    let changed = false;
    for (const pos of detections.keys()) {
      if (!livePositions.has(pos)) {
        detections.delete(pos);
        promoted.delete(pos);
        changed = true;
      }
    }
    if (changed) emitSnapshot();
  };

  return new Plugin({
    key: glinerExtractorKey,
    view(view) {
      ensureWorker(view);
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
          detections.clear();
          promoted.clear();
        },
      };
    },
  });
}
