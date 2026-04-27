/**
 * Optional tree-sitter incremental-parse plugin. Posts doc text to the
 * shared tree-sitter Web Worker which emits a `{nodeCount, rootType}`
 * summary the UI can surface as a structural indicator.
 *
 * Kept intentionally lightweight — most users won't need it. The worker
 * is lazy-loaded and disposed with the plugin.
 */

import { Plugin, PluginKey } from "prosemirror-state";

export const treeSitterKey = new PluginKey("glyph-tree-sitter");

export type TreeSitterReport = { nodeCount: number; rootType: string };

export function treeSitterPlugin(
  onReport: (r: TreeSitterReport) => void,
  delayMs = 1800,
): Plugin {
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let ready = false;

  const ensureWorker = (): Worker | null => {
    if (worker) return worker;
    if (typeof window === "undefined") return null;
    try {
      worker = new Worker(
        new URL("../../../workers/treeSitter.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("message", (ev) => {
        const data = ev.data as
          | { type: "ready" }
          | { type: "parsed"; nodeCount?: number; rootType?: string }
          | { type: string };
        if (data && data.type === "ready") {
          ready = true;
          return;
        }
        if (
          data &&
          data.type === "parsed" &&
          typeof (data as { nodeCount?: unknown }).nodeCount === "number" &&
          typeof (data as { rootType?: unknown }).rootType === "string"
        ) {
          onReport({
            nodeCount: (data as { nodeCount: number }).nodeCount,
            rootType: (data as { rootType: string }).rootType,
          });
        }
      });
      worker.postMessage({ type: "init" });
    } catch {
      worker = null;
    }
    return worker;
  };

  return new Plugin({
    key: treeSitterKey,
    view() {
      return {
        update(view, prevState) {
          if (disposed) return;
          if (view.state.doc.eq(prevState.doc)) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            const text = view.state.doc.textContent;
            const w = ensureWorker();
            if (!w || !ready) return;
            w.postMessage({ type: "parse", text });
          }, delayMs);
        },
        destroy() {
          disposed = true;
          if (timer !== null) clearTimeout(timer);
          if (worker) {
            worker.postMessage({ type: "dispose" });
            worker.terminate();
            worker = null;
          }
        },
      };
    },
  });
}
