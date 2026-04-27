import Parser from "web-tree-sitter";
import type { TreeSitterQueryMatch } from "../shared/messages";

/**
 * Incremental parse helpers.
 *
 * For MVP we re-parse the full text on every `parse` request. True
 * incremental parsing requires the main thread to ship edit deltas
 * (`{ startIndex, oldEndIndex, newEndIndex, ... }`) which we then
 * apply via `tree.edit(...)` before re-parsing. That's a future
 * optimization tracked against this file.
 */

export interface StoredTree {
  tree: Parser.Tree;
  docId: string;
}

export const buildParser = (language: Parser.Language): Parser => {
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
};

export const parseDocument = (
  parser: Parser,
  text: string,
  previousTree?: Parser.Tree,
): Parser.Tree => {
  return parser.parse(text, previousTree);
};

export const summarizeTree = (tree: Parser.Tree): {
  nodeCount: number;
  rootType: string;
} => {
  const root = tree.rootNode;
  return {
    nodeCount: root.descendantCount,
    rootType: root.type,
  };
};

export const runQuery = (
  language: Parser.Language,
  tree: Parser.Tree,
  source: string,
): TreeSitterQueryMatch[] => {
  const query = language.query(source);
  try {
    const matches = query.matches(tree.rootNode);
    const out: TreeSitterQueryMatch[] = [];
    for (const match of matches) {
      for (const capture of match.captures) {
        out.push({
          captureName: capture.name,
          text: capture.node.text,
          start: capture.node.startIndex,
          end: capture.node.endIndex,
        });
      }
    }
    return out;
  } finally {
    query.delete();
  }
};

let treeCounter = 0;
export const nextTreeId = (): string => {
  treeCounter += 1;
  return `t${treeCounter.toString(36)}`;
};

export const __resetTreeIdForTests = (): void => {
  treeCounter = 0;
};
