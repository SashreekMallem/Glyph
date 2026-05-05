import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock @google/genai BEFORE importing gemini.ts ----

interface MockState {
  // queue of behaviors for successive generateContentStream calls
  behaviors: Array<
    | { kind: "throw"; err: unknown }
    | {
        kind: "stream";
        chunks: Array<{ text?: string; usageMetadata?: unknown }>;
      }
  >;
  generateCalls: Array<unknown>;
  cacheCalls: Array<unknown>;
  cacheReturn: { name: string } | null;
  cacheThrow: unknown | null;
}

const mockState: MockState = {
  behaviors: [],
  generateCalls: [],
  cacheCalls: [],
  cacheReturn: null,
  cacheThrow: null,
};

function resetMock() {
  mockState.behaviors = [];
  mockState.generateCalls = [];
  mockState.cacheCalls = [];
  mockState.cacheReturn = null;
  mockState.cacheThrow = null;
}

vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models: {
      generateContentStream: (params: unknown) => Promise<AsyncGenerator<unknown>>;
    };
    caches: {
      create: (params: unknown) => Promise<{ name: string } | null>;
    };
    constructor(_opts: { apiKey: string }) {
      this.models = {
        generateContentStream: async (params: unknown) => {
          mockState.generateCalls.push(params);
          const behavior = mockState.behaviors.shift();
          if (!behavior) throw new Error("no behavior queued");
          if (behavior.kind === "throw") throw behavior.err;
          const chunks = behavior.chunks;
          async function* gen() {
            for (const c of chunks) yield c;
          }
          return gen();
        },
      };
      this.caches = {
        create: async (params: unknown) => {
          mockState.cacheCalls.push(params);
          if (mockState.cacheThrow) throw mockState.cacheThrow;
          return mockState.cacheReturn ?? { name: "cachedContents/abc" };
        },
      };
    }
  }
  return { GoogleGenAI };
});

// ---- Now import the module under test ----
import {
  streamExtract,
  ensureCache,
  RFC6902_RESPONSE_SCHEMA,
  GEMINI_MODEL,
} from "../src/gemini";
import type { ExtractEvent } from "../src/types";

const baseRequest = {
  schemaJson: { type: "object" },
  schemaVersion: "v1",
  currentEase: {},
  textDelta: "hello",
  fullText: "hello",
  sessionId: "s1",
};

async function collect(
  gen: AsyncGenerator<ExtractEvent>,
): Promise<ExtractEvent[]> {
  const out: ExtractEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

beforeEach(() => {
  resetMock();
});

describe("streamExtract", () => {
  it("parses streamed chunks incrementally and yields patch events", async () => {
    mockState.behaviors.push({
      kind: "stream",
      chunks: [
        { text: '[{"op":"add","path":"/a","value":1}' },
        { text: ',{"op":"replace","path":"/b","value":2}]' },
        {
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
            cachedContentTokenCount: 0,
          },
        },
      ],
    });
    const events = await collect(
      streamExtract(baseRequest, { apiKey: "k" }),
    );
    const patches = events.filter((e) => e.type === "patch");
    expect(patches).toHaveLength(2);
    expect(patches[0].patches?.[0]).toMatchObject({
      op: "add",
      path: "/a",
      value: 1,
    });
    expect(patches[1].patches?.[0]).toMatchObject({
      op: "replace",
      path: "/b",
      value: 2,
    });
    const usage = events.find((e) => e.type === "usage");
    expect(usage?.usage?.totalTokens).toBe(15);
    expect(events[events.length - 1].type).toBe("done");
  });

  it("tolerates partial JSON mid-chunk via lenient parser", async () => {
    mockState.behaviors.push({
      kind: "stream",
      chunks: [
        { text: '[{"op":"ad' }, // truncated mid-key
        { text: 'd","path":"/x","val' }, // still partial
        { text: 'ue":42}]' },
      ],
    });
    const events = await collect(
      streamExtract(baseRequest, { apiKey: "k" }),
    );
    const patches = events.filter((e) => e.type === "patch");
    expect(patches).toHaveLength(1);
    expect(patches[0].patches?.[0]).toMatchObject({
      op: "add",
      path: "/x",
      value: 42,
    });
  });

  it("retries on 429 with exponential backoff and eventually succeeds", async () => {
    const err429: Error & { status?: number } = Object.assign(
      new Error("rate limited"),
      { status: 429 },
    );
    mockState.behaviors.push({ kind: "throw", err: err429 });
    mockState.behaviors.push({ kind: "throw", err: err429 });
    mockState.behaviors.push({
      kind: "stream",
      chunks: [{ text: '[{"op":"remove","path":"/y"}]' }],
    });
    const events = await collect(
      streamExtract(baseRequest, { apiKey: "k", maxRetries: 3 }),
    );
    expect(mockState.generateCalls.length).toBe(3);
    const patches = events.filter((e) => e.type === "patch");
    expect(patches).toHaveLength(1);
    expect(patches[0].patches?.[0]).toMatchObject({
      op: "remove",
      path: "/y",
    });
  });

  it("does not retry on non-429 4xx errors", async () => {
    const err400: Error & { status?: number } = Object.assign(
      new Error("bad request"),
      { status: 400 },
    );
    mockState.behaviors.push({ kind: "throw", err: err400 });
    const events = await collect(
      streamExtract(baseRequest, { apiKey: "k", maxRetries: 3 }),
    );
    expect(mockState.generateCalls.length).toBe(1);
    const errEvents = events.filter((e) => e.type === "error");
    expect(errEvents).toHaveLength(1);
    expect(errEvents[0].error).toMatch(/bad request/);
  });

  it("respects abort signal and stops the generator", async () => {
    const ac = new AbortController();
    // Stream will yield infinitely-ish; we abort after first chunk.
    async function* slowChunks() {
      yield { text: '[{"op":"add","path":"/a","value":1}' };
      // wait then yield more — but consumer will have aborted by then
      await new Promise((r) => setTimeout(r, 50));
      yield { text: ',{"op":"add","path":"/b","value":2}]' };
    }
    // Custom behavior: replace generateContentStream's queued response
    mockState.behaviors.push({
      kind: "stream",
      chunks: [
        { text: '[{"op":"add","path":"/a","value":1}' },
        // We'll abort before this lands by aborting after first iteration
        { text: ',{"op":"add","path":"/b","value":2}]' },
      ],
    });
    void slowChunks; // silence unused
    const gen = streamExtract(baseRequest, {
      apiKey: "k",
      signal: ac.signal,
    });
    const out: ExtractEvent[] = [];
    for await (const ev of gen) {
      out.push(ev);
      if (ev.type === "patch") {
        ac.abort();
      }
    }
    // Should have at least one patch then an aborted error event.
    const errEvents = out.filter((e) => e.type === "error");
    expect(errEvents.some((e) => e.error === "aborted")).toBe(true);
  });

  it("reports token usage on completion", async () => {
    mockState.behaviors.push({
      kind: "stream",
      chunks: [
        { text: "[]" },
        {
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 20,
            totalTokenCount: 120,
            cachedContentTokenCount: 50,
          },
        },
      ],
    });
    const events = await collect(
      streamExtract(baseRequest, { apiKey: "k" }),
    );
    const usage = events.find((e) => e.type === "usage");
    expect(usage?.usage).toEqual({
      promptTokens: 100,
      cachedTokens: 50,
      candidatesTokens: 20,
      totalTokens: 120,
    });
  });

  it("sends responseMimeType=application/json and does NOT send responseSchema", async () => {
    mockState.behaviors.push({
      kind: "stream",
      chunks: [{ text: "[]" }],
    });
    await collect(streamExtract(baseRequest, { apiKey: "k" }));
    expect(mockState.generateCalls).toHaveLength(1);
    const call = mockState.generateCalls[0] as {
      config: { responseSchema?: unknown; responseMimeType: string };
      model: string;
    };
    // Schema constraint deliberately removed — the Vertex schema dialect
    // can't represent "value: any JSON value" without breaking patches.
    expect(call.config.responseSchema).toBeUndefined();
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.model).toBe(GEMINI_MODEL);
    // Constant stays exported for back-compat / introspection.
    expect(RFC6902_RESPONSE_SCHEMA).toBeDefined();
  });

  it("attaches cachedContent when cacheRef is provided", async () => {
    mockState.behaviors.push({
      kind: "stream",
      chunks: [{ text: "[]" }],
    });
    await collect(
      streamExtract(baseRequest, {
        apiKey: "k",
        cacheRef: "cachedContents/xyz",
      }),
    );
    const call = mockState.generateCalls[0] as {
      config: { cachedContent?: string };
    };
    expect(call.config.cachedContent).toBe("cachedContents/xyz");
  });
});

describe("ensureCache", () => {
  it("returns the cache resource name when create succeeds", async () => {
    mockState.cacheReturn = { name: "cachedContents/abc123" };
    const name = await ensureCache({
      apiKey: "k",
      prefix: "long prefix text...",
      ttlSeconds: 600,
    });
    expect(name).toBe("cachedContents/abc123");
    expect(mockState.cacheCalls).toHaveLength(1);
  });

  it("returns null when cache create fails (fallback to inline)", async () => {
    mockState.cacheThrow = new Error("prefix too short");
    const name = await ensureCache({
      apiKey: "k",
      prefix: "tiny",
    });
    expect(name).toBeNull();
  });
});
