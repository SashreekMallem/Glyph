/**
 * Client-side document-type classifier plugin.
 *
 * Posts the plain-text content to a shared Web Worker that runs a
 * zero-shot MNLI model (see `src/workers/classifier.worker.ts`). The
 * worker throttles and streams back `{label, score}` results which we
 * forward to the caller — typically the UI flags a mismatch if the
 * predicted label differs from the current doc type with high
 * confidence.
 *
 * The worker is lazy-loaded on first use so the initial editor render
 * stays snappy.
 */

import { Plugin, PluginKey } from "prosemirror-state";

export const classifierKey = new PluginKey("glyph-classifier");

export type ClassifierReport = { label: string; score: number };

export function classifierPlugin(
  onReport: (r: ClassifierReport) => void,
  delayMs = 2500,
): Plugin {
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const ensureWorker = (): Worker | null => {
    if (worker) return worker;
    if (typeof window === "undefined") return null;
    try {
      worker = new Worker(
        new URL("../../../workers/classifier.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("message", (ev) => {
        const data = ev.data as
          | { type: "result"; label?: string; score?: number }
          | { type: string };
        if (
          data &&
          data.type === "result" &&
          typeof (data as { label?: unknown }).label === "string" &&
          typeof (data as { score?: unknown }).score === "number"
        ) {
          onReport({
            label: (data as { label: string }).label,
            score: (data as { score: number }).score,
          });
        }
      });
    } catch {
      worker = null;
    }
    return worker;
  };

  return new Plugin({
    key: classifierKey,
    view() {
      return {
        update(view, prevState) {
          if (disposed) return;
          if (view.state.doc.eq(prevState.doc)) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            const text = view.state.doc.textContent;
            if (text.length < 40) return;
            const w = ensureWorker();
            if (!w) return;
            w.postMessage({ type: "classify", text });
          }, delayMs);
        },
        destroy() {
          disposed = true;
          if (timer !== null) clearTimeout(timer);
          if (worker) {
            worker.terminate();
            worker = null;
          }
        },
      };
    },
  });
}
