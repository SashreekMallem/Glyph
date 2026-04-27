import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TreeSitterResponse } from "../shared/messages";

// Mock grammars + parser boundaries.
vi.mock("../treeSitter/grammars", () => {
  const fakeLanguage = { __fake: "language" } as unknown;
  return {
    GRAMMAR_PUBLIC_PREFIX: "/tree-sitter",
    grammarWasmPath: (g: string) =>
      g === "markdown" ? "/tree-sitter/tree-sitter-markdown.wasm" : null,
    ensureParserInit: vi.fn(async () => {
      /* noop */
    }),
    loadGrammar: vi.fn(async () => fakeLanguage),
    __resetGrammarsForTests: vi.fn(),
  };
});

vi.mock("../treeSitter/parser", () => {
  const parserDeleteSpy = vi.fn();
  const fakeTree = { __fake: "tree", delete: vi.fn() };
  let idSeq = 0;
  return {
    buildParser: vi.fn(() => ({
      delete: parserDeleteSpy,
    })),
    parseDocument: vi.fn(() => fakeTree),
    summarizeTree: vi.fn(() => ({ nodeCount: 7, rootType: "document" })),
    runQuery: vi.fn(() => [
      { captureName: "heading", text: "Hello", start: 0, end: 5 },
    ]),
    nextTreeId: vi.fn(() => `t${++idSeq}`),
    __resetTreeIdForTests: () => {
      idSeq = 0;
    },
    __fakeTree: fakeTree,
    __parserDeleteSpy: parserDeleteSpy,
  };
});

const { handleTreeSitterMessage, __resetTreeSitterWorkerForTests } = await import(
  "../treeSitter.worker"
);

const makeTarget = () => {
  const posts: TreeSitterResponse[] = [];
  return {
    posts,
    postMessage: (msg: TreeSitterResponse) => {
      posts.push(msg);
    },
  };
};

beforeEach(() => {
  __resetTreeSitterWorkerForTests();
});

afterEach(() => {
  __resetTreeSitterWorkerForTests();
});

describe("tree-sitter worker", () => {
  it("emits ready on init with a valid grammar", async () => {
    const target = makeTarget();
    await handleTreeSitterMessage({ type: "init", grammar: "markdown" }, target);
    expect(target.posts).toContainEqual({ type: "ready" });
  });

  it("errors on parse before init", async () => {
    const target = makeTarget();
    await handleTreeSitterMessage(
      { type: "parse", docId: "d1", text: "# hi" },
      target,
    );
    expect(target.posts[0]?.type).toBe("error");
  });

  it("emits parsed with nodeCount and rootType after init", async () => {
    const target = makeTarget();
    await handleTreeSitterMessage({ type: "init", grammar: "markdown" }, target);
    await handleTreeSitterMessage(
      { type: "parse", docId: "d1", text: "# hello" },
      target,
    );
    const parsed = target.posts.find((m) => m.type === "parsed");
    expect(parsed).toMatchObject({
      type: "parsed",
      docId: "d1",
      nodeCount: 7,
      rootType: "document",
    });
  });

  it("query before tree errors", async () => {
    const target = makeTarget();
    await handleTreeSitterMessage({ type: "init", grammar: "markdown" }, target);
    await handleTreeSitterMessage(
      { type: "query", docId: "missing", query: "(heading) @h" },
      target,
    );
    const errs = target.posts.filter((m) => m.type === "error");
    expect(errs.length).toBeGreaterThan(0);
  });

  it("dispose(docId) removes that doc; dispose() clears all", async () => {
    const target = makeTarget();
    await handleTreeSitterMessage({ type: "init", grammar: "markdown" }, target);
    await handleTreeSitterMessage(
      { type: "parse", docId: "d1", text: "# a" },
      target,
    );
    await handleTreeSitterMessage(
      { type: "parse", docId: "d2", text: "# b" },
      target,
    );
    // Dispose just d1 — d2 query should still work.
    await handleTreeSitterMessage({ type: "dispose", docId: "d1" }, target);
    target.posts.length = 0;
    await handleTreeSitterMessage(
      { type: "query", docId: "d1", query: "(heading) @h" },
      target,
    );
    expect(target.posts[0]?.type).toBe("error");

    // Dispose everything.
    await handleTreeSitterMessage({ type: "dispose" }, target);
    target.posts.length = 0;
    await handleTreeSitterMessage(
      { type: "parse", docId: "d3", text: "# c" },
      target,
    );
    // No parser init'd anymore → should error.
    expect(target.posts[0]?.type).toBe("error");
  });
});
