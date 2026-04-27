import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassifierResponse } from "../shared/messages";

// Mock the model boundary so no real Transformers.js load happens in tests.
vi.mock("../classifier/model", () => {
  const pipelineMock = vi.fn();
  return {
    CLASSIFIER_MODEL: "Xenova/distilbart-mnli-12-3",
    detectDevice: () => "wasm" as const,
    loadClassifier: vi.fn(async ({ onProgress }: { onProgress?: (e: { file: string; loaded: number; total: number }) => void }) => {
      onProgress?.({ file: "config.json", loaded: 1, total: 1 });
      return pipelineMock;
    }),
    pickTopResult: (result: unknown) => {
      const r = result as { labels?: string[]; scores?: number[] } | null;
      if (!r || !r.labels || !r.scores || r.labels.length === 0) return null;
      const label = r.labels[0];
      const score = r.scores[0];
      if (typeof label !== "string" || typeof score !== "number") return null;
      return { label, score };
    },
    __pipelineMock: pipelineMock,
  };
});

// Re-import after mock is registered.
const modelModule = await import("../classifier/model");
const { handleClassifierMessage, __resetClassifierForTests } = await import(
  "../classifier.worker"
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipelineMock = (modelModule as any).__pipelineMock as ReturnType<typeof vi.fn>;

const makeTarget = () => {
  const posts: ClassifierResponse[] = [];
  return {
    posts,
    postMessage: (msg: ClassifierResponse) => {
      posts.push(msg);
    },
  };
};

beforeEach(() => {
  __resetClassifierForTests();
  pipelineMock.mockReset();
});

afterEach(() => {
  __resetClassifierForTests();
});

describe("classifier worker", () => {
  it("skips text shorter than 10 chars as too_short", async () => {
    const target = makeTarget();
    await handleClassifierMessage(
      {
        type: "classify",
        fieldId: "f1",
        text: "short",
        documentType: "contract",
      },
      target,
    );
    expect(target.posts).toContainEqual({
      type: "skipped",
      fieldId: "f1",
      reason: "too_short",
    });
  });

  it("emits result when top confidence >= 0.85", async () => {
    pipelineMock.mockResolvedValue({
      labels: ["party name", "obligation"],
      scores: [0.92, 0.06],
    });
    const target = makeTarget();
    await handleClassifierMessage(
      {
        type: "classify",
        fieldId: "f1",
        text: "Acme Corporation, a Delaware corporation",
        documentType: "contract",
      },
      target,
    );
    expect(target.posts).toContainEqual({
      type: "result",
      fieldId: "f1",
      label: "party name",
      confidence: 0.92,
    });
  });

  it("skips low_confidence when top score < 0.85", async () => {
    pipelineMock.mockResolvedValue({
      labels: ["party name"],
      scores: [0.4],
    });
    const target = makeTarget();
    await handleClassifierMessage(
      {
        type: "classify",
        fieldId: "f1",
        text: "some reasonably long candidate text",
        documentType: "contract",
      },
      target,
    );
    expect(target.posts).toContainEqual({
      type: "skipped",
      fieldId: "f1",
      reason: "low_confidence",
    });
  });

  it("emits error when the pipeline throws", async () => {
    pipelineMock.mockRejectedValue(new Error("kaboom"));
    const target = makeTarget();
    await handleClassifierMessage(
      {
        type: "classify",
        fieldId: "f1",
        text: "some reasonably long candidate text",
        documentType: "contract",
      },
      target,
    );
    const errorMsg = target.posts.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg).toMatchObject({ type: "error", fieldId: "f1" });
  });

  it("dispose clears internal state", async () => {
    const target = makeTarget();
    await handleClassifierMessage({ type: "dispose" }, target);
    // No postMessage expected on dispose, just no throw.
    expect(target.posts).toEqual([]);
  });
});
