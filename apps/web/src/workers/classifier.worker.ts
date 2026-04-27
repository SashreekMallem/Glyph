/// <reference lib="webworker" />

import type { ZeroShotClassificationPipeline } from "@xenova/transformers";
import type {
  ClassifierRequest,
  ClassifierResponse,
} from "./shared/messages";
import {
  CLASSIFIER_LABELS,
  CONFIDENCE_THRESHOLD,
  HYPOTHESIS_TEMPLATE,
  MIN_TEXT_LENGTH,
} from "./classifier/labels";
import { loadClassifier, pickTopResult } from "./classifier/model";

// Typed worker global. Browsers inject `self: DedicatedWorkerGlobalScope`
// at worker instantiation; vitest (node env) does not, so tests pull the
// dispatcher directly rather than rely on this global.
declare const self: DedicatedWorkerGlobalScope;

let classifier: ZeroShotClassificationPipeline | null = null;
let loading: Promise<ZeroShotClassificationPipeline> | null = null;

const post = (
  target: Pick<DedicatedWorkerGlobalScope, "postMessage">,
  msg: ClassifierResponse,
): void => {
  target.postMessage(msg);
};

const ensureClassifier = async (
  target: Pick<DedicatedWorkerGlobalScope, "postMessage">,
): Promise<ZeroShotClassificationPipeline> => {
  if (classifier) return classifier;
  if (!loading) {
    loading = loadClassifier({
      onProgress: (evt) => {
        post(target, {
          type: "progress",
          file: evt.file,
          loaded: evt.loaded,
          total: evt.total,
        });
      },
    })
      .then((pipe) => {
        classifier = pipe;
        post(target, { type: "ready" });
        return pipe;
      })
      .catch((err: unknown) => {
        loading = null;
        throw err;
      });
  }
  return loading;
};

export const handleClassifierMessage = async (
  msg: ClassifierRequest,
  target: Pick<DedicatedWorkerGlobalScope, "postMessage">,
): Promise<void> => {
  try {
    switch (msg.type) {
      case "init": {
        await ensureClassifier(target);
        return;
      }

      case "classify": {
        const { fieldId, text, documentType, candidateLabels } = msg;

        if (text.length < MIN_TEXT_LENGTH) {
          post(target, { type: "skipped", fieldId, reason: "too_short" });
          return;
        }

        const labels =
          candidateLabels && candidateLabels.length > 0
            ? candidateLabels
            : CLASSIFIER_LABELS[documentType];

        const pipe = await ensureClassifier(target);

        let output;
        try {
          output = await pipe(text, labels, {
            hypothesis_template: HYPOTHESIS_TEMPLATE,
            multi_label: false,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          post(target, { type: "error", fieldId, message });
          return;
        }

        const top = pickTopResult(output);
        if (!top) {
          post(target, {
            type: "error",
            fieldId,
            message: "classifier returned empty output",
          });
          return;
        }

        if (top.score < CONFIDENCE_THRESHOLD) {
          post(target, { type: "skipped", fieldId, reason: "low_confidence" });
          return;
        }

        post(target, {
          type: "result",
          fieldId,
          label: top.label,
          confidence: top.score,
        });
        return;
      }

      case "dispose": {
        classifier = null;
        loading = null;
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fieldId = msg.type === "classify" ? msg.fieldId : undefined;
    post(target, { type: "error", fieldId, message });
  }
};

// Reset state (test-only helper; harmless in browsers).
export const __resetClassifierForTests = (): void => {
  classifier = null;
  loading = null;
};

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (e: MessageEvent<ClassifierRequest>): void => {
    void handleClassifierMessage(e.data, self);
  };
}
