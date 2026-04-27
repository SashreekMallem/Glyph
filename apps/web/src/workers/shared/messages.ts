// Shared discriminated union message types for Glyph workers.
//
// Both `classifier.worker.ts` and `treeSitter.worker.ts` import from this file
// so the main thread (editor) and the workers agree on the wire format.
//
// Rules:
// - Never put functions or class instances on these messages (structured clone).
// - Keep payloads flat; prefer primitives over nested objects.

export type DocumentType = "contract" | "resume" | "invoice";

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export type ClassifierRequest =
  | { type: "init" }
  | {
      type: "classify";
      fieldId: string;
      text: string;
      documentType: DocumentType;
      candidateLabels?: string[];
    }
  | { type: "dispose" };

export type ClassifierResponse =
  | { type: "ready" }
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "result"; fieldId: string; label: string; confidence: number }
  | {
      type: "skipped";
      fieldId: string;
      reason: "too_short" | "low_confidence";
    }
  | { type: "error"; fieldId?: string; message: string };

// ---------------------------------------------------------------------------
// Tree-sitter
// ---------------------------------------------------------------------------

export type TreeSitterGrammar = "markdown" | "html" | "plain";

export type TreeSitterRequest =
  | { type: "init"; grammar: TreeSitterGrammar }
  | { type: "parse"; docId: string; text: string; previousTreeId?: string }
  | { type: "query"; docId: string; query: string }
  | { type: "dispose"; docId?: string };

export interface TreeSitterQueryMatch {
  captureName: string;
  text: string;
  start: number;
  end: number;
}

export type TreeSitterResponse =
  | { type: "ready" }
  | {
      type: "parsed";
      docId: string;
      treeId: string;
      nodeCount: number;
      rootType: string;
    }
  | {
      type: "queryResult";
      docId: string;
      matches: TreeSitterQueryMatch[];
    }
  | { type: "error"; message: string };
