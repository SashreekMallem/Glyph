/// <reference lib="webworker" />

/**
 * LLM worker — Qwen2.5-0.5B-Instruct via Transformers.js loaded from CDN.
 *
 * Uses importScripts at runtime to load @huggingface/transformers from CDN,
 * bypassing the webpack onnxruntime-web stub aliases that break the bundled version.
 */

declare const self: DedicatedWorkerGlobalScope;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any;

let llm: AnyPipeline = null;
let loading: Promise<AnyPipeline> | null = null;

const PROGRESS_CB = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
  if (p.status === "progress" && p.total) {
    self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
  }
};

function loadTransformers(): Promise<{ pipeline: AnyPipeline; env: AnyPipeline }> {
  return new Promise((resolve, reject) => {
    try {
      self.importScripts("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = self as any;
      if (g.transformers?.pipeline) {
        resolve({ pipeline: g.transformers.pipeline, env: g.transformers.env });
      } else {
        reject(new Error("transformers global not found after importScripts"));
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureLLM(): Promise<AnyPipeline> {
  if (llm) return llm;
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await loadTransformers();
      env.allowRemoteModels = true;
      env.useBrowserCache = true;

      const opts = { progress_callback: PROGRESS_CB, dtype: "q4" };
      let pipe: AnyPipeline;
      try {
        pipe = await pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", { ...opts, device: "webgpu" });
      } catch {
        pipe = await pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", { ...opts, device: "wasm" });
      }
      llm = pipe;
      self.postMessage({ type: "ready" });
      return pipe;
    })().catch((err: unknown) => {
      loading = null;
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: "error", message: `LLM init failed: ${message}` });
      throw err;
    });
  }
  return loading;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as {
    type: string;
    requestId?: string;
    prompt?: string;
    maxTokens?: number;
  };

  try {
    if (msg.type === "init") {
      await ensureLLM();
      return;
    }

    if (msg.type === "generate") {
      const { requestId, prompt, maxTokens = 500 } = msg;
      if (!prompt) {
        self.postMessage({ type: "error", requestId, message: "missing prompt" });
        return;
      }
      const pipe = await ensureLLM();
      const out = await pipe(prompt, {
        max_new_tokens: maxTokens,
        temperature: 0.05,
        do_sample: false,
        return_full_text: false,
      });
      const text = (out as Array<{ generated_text: string }>)[0]?.generated_text ?? "";
      self.postMessage({ type: "result", requestId, text });
      return;
    }

    if (msg.type === "dispose") {
      llm = null;
      loading = null;
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", requestId: msg.requestId, message });
  }
};
