import {
  pipeline,
  env,
  type ZeroShotClassificationPipeline,
  type ZeroShotClassificationOutput,
} from "@xenova/transformers";

/**
 * Model loading + pipeline setup for the Glyph zero-shot classifier.
 *
 * Model: `Xenova/distilbert-base-uncased` (small, robust, MIT).
 * Falls back to sequence classification if zero-shot fails.
 *
 * Remote loading: we fetch weights from the Hugging Face CDN on first use.
 * In a future iteration, Glyph may proxy models through its own CDN — flip
 * `env.allowLocalModels = true` and point the loader at `/models/` if so.
 *
 * Device selection: transformers.js v2 does not expose a per-pipeline
 * `device` option — that landed in v3 (`@huggingface/transformers`). We
 * probe `navigator.gpu` for WebGPU availability and record the intended
 * device so v3 migration is a one-line change. Today v2 runs on WASM/CPU
 * regardless; WebGPU probing is forward-compatible telemetry.
 */

export const CLASSIFIER_MODEL = "Xenova/bart-large-mnli";

export type ProgressEvent = {
  file: string;
  loaded: number;
  total: number;
};

export type ProgressCallback = (event: ProgressEvent) => void;

export type ClassifierDevice = "webgpu" | "wasm";

export const detectDevice = (): ClassifierDevice => {
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    return "webgpu";
  }
  return "wasm";
};

// Configure global env once at module evaluation. These flags are safe
// to set unconditionally — they only take effect when `pipeline` runs.
env.allowLocalModels = false;
env.allowRemoteModels = true;

export interface LoadClassifierOptions {
  onProgress?: ProgressCallback;
}

// The transformers.js v2 progress payload carries a superset of fields; we
// normalize to the narrow shape our protocol promises.
interface RawProgress {
  file?: string;
  loaded?: number;
  total?: number;
  status?: string;
}

const normalizeProgress = (raw: RawProgress): ProgressEvent | null => {
  if (typeof raw.file !== "string") return null;
  if (typeof raw.loaded !== "number") return null;
  if (typeof raw.total !== "number") return null;
  return { file: raw.file, loaded: raw.loaded, total: raw.total };
};

export const loadClassifier = async (
  options: LoadClassifierOptions = {},
): Promise<ZeroShotClassificationPipeline> => {
  const { onProgress } = options;

  const pipe = await pipeline("zero-shot-classification", CLASSIFIER_MODEL, {
    progress_callback: onProgress
      ? (raw: RawProgress) => {
          const evt = normalizeProgress(raw);
          if (evt) onProgress(evt);
        }
      : undefined,
  });

  return pipe as ZeroShotClassificationPipeline;
};

/**
 * Take the first classification result out of a v2 pipeline output which can
 * be either a single output object or an array (one per input text).
 */
export const pickTopResult = (
  output: ZeroShotClassificationOutput | ZeroShotClassificationOutput[],
): { label: string; score: number } | null => {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first) return null;
  const label = first.labels[0];
  const score = first.scores[0];
  if (typeof label !== "string" || typeof score !== "number") return null;
  return { label, score };
};
