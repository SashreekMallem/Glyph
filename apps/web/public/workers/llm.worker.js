/**
 * LLM worker — served as a static file from /public so webpack doesn't bundle it.
 * Loads @huggingface/transformers v3 from CDN via importScripts.
 */

importScripts("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js");

const { pipeline, env } = self.transformers ?? globalThis.transformers ?? {};
env.allowRemoteModels = true;
env.useBrowserCache = true;

let llm = null;
let loading = null;

const PROGRESS_CB = (p) => {
  if (p.status === "progress" && p.total) {
    self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
  }
};

async function ensureLLM() {
  if (llm) return llm;
  if (!loading) {
    loading = (async () => {
      const opts = { progress_callback: PROGRESS_CB, dtype: "q4" };
      let pipe;
      try {
        pipe = await pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", { ...opts, device: "webgpu" });
      } catch {
        pipe = await pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", { ...opts, device: "wasm" });
      }
      llm = pipe;
      self.postMessage({ type: "ready" });
      return pipe;
    })().catch((err) => {
      loading = null;
      self.postMessage({ type: "error", message: `LLM init failed: ${err.message}` });
      throw err;
    });
  }
  return loading;
}

self.onmessage = async (e) => {
  const msg = e.data;
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
      const text = out[0]?.generated_text ?? "";
      self.postMessage({ type: "result", requestId, text });
      return;
    }
    if (msg.type === "dispose") {
      llm = null;
      loading = null;
      return;
    }
  } catch (err) {
    self.postMessage({ type: "error", requestId: msg.requestId, message: err.message });
  }
};
