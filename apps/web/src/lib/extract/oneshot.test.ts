/**
 * Unit tests for `extractOneShot`.
 *
 * `streamExtract` (Gemini) and the schema resolver are both mocked so the
 * tests cover the helper's own logic — accumulation of patches, EASE
 * decode, error / abort surfacing, optional persistence — without
 * standing up a real DB or hitting the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

import type { ExtractEvent } from "@glyph/extract";

// ---------------------------------------------------------------------------
// Module mocks (must precede the SUT import).
// ---------------------------------------------------------------------------

let mockEvents: ExtractEvent[] = [];
let receivedSignal: AbortSignal | undefined;

vi.mock("@glyph/extract", async () => {
  const actual = await vi.importActual<typeof import("@glyph/extract")>(
    "@glyph/extract",
  );
  return {
    ...actual,
    streamExtract: async function* (
      _req: unknown,
      opts: { signal?: AbortSignal },
    ): AsyncGenerator<ExtractEvent> {
      receivedSignal = opts.signal;
      for (const ev of mockEvents) {
        if (opts.signal?.aborted) return;
        yield ev;
      }
    },
  };
});

const ResumeShape = z.object({
  document_type: z.literal("resume"),
  schema_version: z.string(),
  full_name: z.string(),
});

vi.mock("@/lib/extract/resolve-schema", () => ({
  SchemaNotFoundError: class extends Error {
    constructor(public readonly typeKey: string) {
      super(`schema not found: ${typeKey}`);
    }
  },
  resolveSchema: vi.fn(async (_db: unknown, args: { typeKey: string }) => {
    if (args.typeKey === "missing") {
      const Err = (await import("@/lib/extract/resolve-schema"))
        .SchemaNotFoundError;
      throw new Err(args.typeKey);
    }
    return {
      zodSchema: ResumeShape,
      schemaJson: { type: "object" },
      schemaVersion: "test-v1",
      source: "builtin" as const,
    };
  }),
}));

import { extractOneShot, OneShotExtractError } from "./oneshot";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockEvents = [];
  receivedSignal = undefined;
});

const usageEv: ExtractEvent = {
  type: "usage",
  usage: {
    promptTokens: 100,
    cachedTokens: 50,
    candidatesTokens: 25,
    totalTokens: 175,
  },
};
const doneEv: ExtractEvent = { type: "done" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractOneShot — happy path", () => {
  it("accumulates patches and decodes EASE state", async () => {
    mockEvents = [
      {
        type: "patch",
        patches: [
          { op: "add", path: "/document_type", value: "resume" },
          { op: "add", path: "/schema_version", value: "1.0" },
        ],
      },
      {
        type: "patch",
        patches: [{ op: "add", path: "/full_name", value: "Ada Lovelace" }],
      },
      usageEv,
      doneEv,
    ];

    const result = await extractOneShot({
      text: "Ada Lovelace, mathematician",
      typeKey: "resume",
      userId: "u1",
    });

    expect(result.json).toEqual({
      document_type: "resume",
      schema_version: "1.0",
      full_name: "Ada Lovelace",
    });
    expect(result.episodes).toHaveLength(3);
    expect(result.usage.totalTokens).toBe(175);
    expect(result.usage.cachedTokens).toBe(50);
    expect(result.schemaVersion).toBe("test-v1");
    expect(result.sessionId).toBeNull(); // no docId → no persistence
    // Cost is computed from usage + the default pricing table; for the
    // small fake usage above it should be a finite non-negative number.
    expect(typeof result.costUsd).toBe("number");
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
  });

  it("surfaces costUsd when streamExtract reports it", async () => {
    mockEvents = [
      { type: "patch", patches: [{ op: "add", path: "/full_name", value: "x" }] },
      {
        type: "usage",
        usage: {
          promptTokens: 10,
          cachedTokens: 0,
          candidatesTokens: 5,
          totalTokens: 15,
          costUsd: 0.0042,
        },
      },
      doneEv,
    ];
    const result = await extractOneShot({
      text: "x",
      typeKey: "resume",
      userId: "u1",
    });
    expect(result.costUsd).toBe(0.0042);
  });
});

describe("extractOneShot — error surfacing", () => {
  it("throws OneShotExtractError on stream error events", async () => {
    mockEvents = [
      { type: "patch", patches: [{ op: "add", path: "/x", value: 1 }] },
      { type: "error", error: "rate_limit" },
    ];
    await expect(
      extractOneShot({ text: "t", typeKey: "resume", userId: "u1" }),
    ).rejects.toMatchObject({
      name: "OneShotExtractError",
      code: "stream_error",
      message: "rate_limit",
    });
  });

  it("throws OneShotExtractError(aborted) on abort event", async () => {
    mockEvents = [{ type: "error", error: "aborted" }];
    await expect(
      extractOneShot({ text: "t", typeKey: "resume", userId: "u1" }),
    ).rejects.toMatchObject({
      code: "aborted",
    });
  });

  it("re-throws SchemaNotFoundError when typeKey is unknown", async () => {
    await expect(
      extractOneShot({ text: "t", typeKey: "missing", userId: "u1" }),
    ).rejects.toThrow(/schema not found/);
  });
});

describe("extractOneShot — abort signal", () => {
  it("forwards the caller's AbortSignal to streamExtract", async () => {
    mockEvents = [doneEv];
    const ctl = new AbortController();
    await extractOneShot({
      text: "t",
      typeKey: "resume",
      userId: "u1",
      signal: ctl.signal,
    });
    expect(receivedSignal).toBe(ctl.signal);
  });

  it("stops yielding once signal is aborted before iteration", async () => {
    mockEvents = [
      { type: "patch", patches: [{ op: "add", path: "/x", value: 1 }] },
      doneEv,
    ];
    const ctl = new AbortController();
    ctl.abort();

    // No patches consumed; usage stays at zeros; episodes empty; no error
    // event was emitted by our mock so the helper resolves "successfully".
    const result = await extractOneShot({
      text: "t",
      typeKey: "resume",
      userId: "u1",
      signal: ctl.signal,
    });
    expect(result.episodes).toEqual([]);
    expect(result.usage.totalTokens).toBe(0);
  });
});

describe("extractOneShot — persistence", () => {
  it("opens + closes a session and appends one episode per op when db+docId given", async () => {
    mockEvents = [
      {
        type: "patch",
        patches: [
          { op: "add", path: "/document_type", value: "resume" },
          { op: "add", path: "/schema_version", value: "1.0" },
          { op: "add", path: "/full_name", value: "Ada" },
        ],
      },
      usageEv,
      doneEv,
    ];

    const inserts: Array<{ table: string; values: Record<string, unknown> }> =
      [];
    const updates: Array<{ table: string; set: Record<string, unknown> }> = [];

    const tableName = (t: unknown): string => {
      // Drizzle tables stringify to symbols; we tag inserts so the test can
      // distinguish sessions vs. episodes by call order instead.
      return typeof t === "object" && t && "name" in (t as object)
        ? String((t as { name: unknown }).name)
        : "unknown";
    };

    let nextId = 1;
    const db = {
      insert: (table: unknown) => ({
        values: (row: Record<string, unknown>) => ({
          returning: async () => {
            const id = `id_${nextId++}`;
            inserts.push({ table: tableName(table), values: row });
            return [{ id }];
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (row: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ table: tableName(table), set: row });
            return undefined;
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
            orderBy: async () => [],
          }),
        }),
      }),
    };

    const result = await extractOneShot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      docId: "doc-123",
      text: "Ada",
      typeKey: "resume",
      userId: "u1",
    });

    expect(result.sessionId).toBe("id_1");
    // 1 session + 3 episodes = 4 inserts.
    expect(inserts).toHaveLength(4);
    // endSession should have updated the session row.
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it("swallows persistence errors and still returns the in-memory result", async () => {
    mockEvents = [
      { type: "patch", patches: [{ op: "add", path: "/full_name", value: "Ada" }] },
      doneEv,
    ];
    const db = {
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: "sess_1" }],
        }),
      }),
      update: () => ({
        set: () => ({ where: async () => undefined }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
            orderBy: async () => [],
          }),
        }),
      }),
    };
    // Make appendEpisode throw by replacing the insert path on the second
    // call. The simplest way: throw on every insert AFTER the first.
    let inserts = 0;
    db.insert = () => ({
      values: () => ({
        returning: async () => {
          inserts++;
          if (inserts === 1) return [{ id: "sess_1" }];
          throw new Error("db blew up");
        },
      }),
    });

    const result = await extractOneShot({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      docId: "d",
      text: "Ada",
      typeKey: "resume",
      userId: "u1",
    });
    expect(result.sessionId).toBe("sess_1");
    expect(result.episodes).toHaveLength(1);
  });
});
