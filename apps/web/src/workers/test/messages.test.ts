import { describe, expect, it } from "vitest";

import type {
  ClassifierRequest,
  ClassifierResponse,
  TreeSitterRequest,
  TreeSitterResponse,
} from "../shared/messages";

describe("worker message discriminated unions", () => {
  it("ClassifierRequest narrows on type", () => {
    const msg: ClassifierRequest = {
      type: "classify",
      fieldId: "f",
      text: "x",
      documentType: "contract",
    };
    if (msg.type === "classify") {
      expect(msg.fieldId).toBe("f");
    }
  });

  it("ClassifierResponse narrows on type", () => {
    const msg: ClassifierResponse = {
      type: "result",
      fieldId: "f",
      label: "party name",
      confidence: 0.9,
    };
    if (msg.type === "result") {
      expect(msg.confidence).toBeGreaterThan(0.8);
    }
  });

  it("TreeSitterRequest narrows on type", () => {
    const msg: TreeSitterRequest = {
      type: "parse",
      docId: "d",
      text: "# hi",
    };
    if (msg.type === "parse") {
      expect(msg.docId).toBe("d");
    }
  });

  it("TreeSitterResponse narrows on type", () => {
    const msg: TreeSitterResponse = {
      type: "parsed",
      docId: "d",
      treeId: "t1",
      nodeCount: 3,
      rootType: "document",
    };
    if (msg.type === "parsed") {
      expect(msg.nodeCount).toBe(3);
    }
  });

  it("rejects wrong discriminant at compile time", () => {
    // @ts-expect-error — 'classify' requires fieldId/text/documentType
    const bad: ClassifierRequest = { type: "classify" };
    expect(bad).toBeDefined();
  });
});
