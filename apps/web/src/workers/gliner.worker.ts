/// <reference lib="webworker" />

/**
 * GLiNER worker — runs entity extraction in a background thread.
 *
 * The worker loads the GLiNER model once and reuses it. Each `extract`
 * message runs inference on the provided text with the given entity labels,
 * returning a list of (text, label, confidence) tuples for matched entities.
 */

import { Gliner } from "gliner";
import { env } from "@xenova/transformers";

declare const self: DedicatedWorkerGlobalScope;

let gliner: Gliner | null = null;
let loading: Promise<Gliner> | null = null;

async function ensureGliner(): Promise<Gliner> {
  if (gliner) return gliner;
  if (!loading) {
    loading = (async () => {
      try {
        env.allowRemoteModels = false;
        env.localModelPath = `${self.location.origin}/`;
        const model = new Gliner({
          tokenizerPath: "gliner",
          onnxSettings: {
            modelPath: `${self.location.origin}/gliner/model.onnx`,
            executionProvider: "wasm",
          },
          transformersSettings: {
            allowLocalModels: true,
            useBrowserCache: true,
          },
        });
        await model.initialize();
        gliner = model;
        self.postMessage({ type: "ready" });
        return model;
      } catch (err) {
        loading = null;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[gliner-worker] init failed:", message);
        self.postMessage({ type: "error", message: `GLiNER init failed: ${message}` });
        throw err;
      }
    })();
  }
  return loading;
}

export async function handleGlinerMessage(msg: {
  type: string;
  requestId?: string;
  text?: string;
  entities?: string[];
  threshold?: number;
}): Promise<void> {
  try {
    if (msg.type === "init") {
      await ensureGliner();
      return;
    }

    if (msg.type === "extract") {
      const { requestId, text, entities, threshold = 0.3 } = msg;
      if (!text || !entities || entities.length === 0) {
        self.postMessage({ type: "error", requestId, message: "missing text or entities" });
        return;
      }

      const model = await ensureGliner();
      const result = await model.inference({
        texts: [text],
        entities,
        threshold,
      });

      if (!result || !result[0]) {
        self.postMessage({ type: "result", requestId, entities: [] });
        return;
      }

      const spans = result[0]
        .filter(
          (span: { spanText: string; label: string; score: number }): span is {
            spanText: string;
            label: string;
            score: number;
          } =>
            span != null &&
            typeof span.spanText === "string" &&
            typeof span.label === "string",
        )
        .map((span: { spanText: string; label: string; score: number }) => ({
          text: span.spanText,
          label: span.label,
          confidence: span.score,
        }));

      self.postMessage({ type: "result", requestId, entities: spans });
      return;
    }

    if (msg.type === "dispose") {
      gliner = null;
      loading = null;
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", requestId: msg.requestId, message });
  }
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (e: MessageEvent): void => {
    void handleGlinerMessage(e.data);
  };
}
