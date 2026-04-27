/// <reference lib="webworker" />

import type Parser from "web-tree-sitter";
import type {
  TreeSitterGrammar,
  TreeSitterRequest,
  TreeSitterResponse,
} from "./shared/messages";
import { loadGrammar } from "./treeSitter/grammars";
import {
  buildParser,
  nextTreeId,
  parseDocument,
  runQuery,
  summarizeTree,
} from "./treeSitter/parser";

declare const self: DedicatedWorkerGlobalScope;

interface WorkerState {
  grammar: TreeSitterGrammar;
  language: Parser.Language;
  parser: Parser;
}

let state: WorkerState | null = null;

// Doc-id → latest tree (one tree per document).
const treesByDoc = new Map<string, { treeId: string; tree: Parser.Tree }>();
// tree-id → tree (for `previousTreeId` lookups).
const treesById = new Map<string, Parser.Tree>();

const post = (
  target: Pick<DedicatedWorkerGlobalScope, "postMessage">,
  msg: TreeSitterResponse,
): void => {
  target.postMessage(msg);
};

const disposeTree = (tree: Parser.Tree): void => {
  try {
    tree.delete();
  } catch {
    // A tree may already be disposed; swallow.
  }
};

const disposeDoc = (docId: string): void => {
  const prev = treesByDoc.get(docId);
  if (!prev) return;
  treesByDoc.delete(docId);
  treesById.delete(prev.treeId);
  disposeTree(prev.tree);
};

const disposeAll = (): void => {
  for (const [, entry] of treesByDoc) {
    disposeTree(entry.tree);
  }
  treesByDoc.clear();
  treesById.clear();
};

export const handleTreeSitterMessage = async (
  msg: TreeSitterRequest,
  target: Pick<DedicatedWorkerGlobalScope, "postMessage">,
): Promise<void> => {
  try {
    switch (msg.type) {
      case "init": {
        const language = await loadGrammar(msg.grammar);
        const parser = buildParser(language);
        state = { grammar: msg.grammar, language, parser };
        post(target, { type: "ready" });
        return;
      }

      case "parse": {
        if (!state) {
          post(target, { type: "error", message: "parser not initialized" });
          return;
        }
        const { docId, text, previousTreeId } = msg;

        // Re-parse from scratch for now; incremental edits are a future
        // optimization that needs edit deltas from the caller.
        const previous =
          previousTreeId !== undefined
            ? treesById.get(previousTreeId)
            : undefined;
        const tree = parseDocument(state.parser, text, previous);

        // Replace any existing tree for this doc.
        disposeDoc(docId);

        const treeId = nextTreeId();
        treesByDoc.set(docId, { treeId, tree });
        treesById.set(treeId, tree);

        const { nodeCount, rootType } = summarizeTree(tree);
        post(target, {
          type: "parsed",
          docId,
          treeId,
          nodeCount,
          rootType,
        });
        return;
      }

      case "query": {
        if (!state) {
          post(target, { type: "error", message: "parser not initialized" });
          return;
        }
        const entry = treesByDoc.get(msg.docId);
        if (!entry) {
          post(target, {
            type: "error",
            message: `no tree for docId '${msg.docId}'`,
          });
          return;
        }
        const matches = runQuery(state.language, entry.tree, msg.query);
        post(target, { type: "queryResult", docId: msg.docId, matches });
        return;
      }

      case "dispose": {
        if (msg.docId !== undefined) {
          disposeDoc(msg.docId);
        } else {
          disposeAll();
          if (state) {
            try {
              state.parser.delete();
            } catch {
              // ignore
            }
            state = null;
          }
        }
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post(target, { type: "error", message });
  }
};

export const __resetTreeSitterWorkerForTests = (): void => {
  disposeAll();
  state = null;
};

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (e: MessageEvent<TreeSitterRequest>): void => {
    void handleTreeSitterMessage(e.data, self);
  };
}
