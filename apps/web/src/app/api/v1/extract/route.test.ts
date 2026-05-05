/**
 * Tests for the new raw-text branch of `/api/v1/extract`.
 *
 * The encrypted-payload branch is covered by `test/extract.test.ts`; here
 * we exercise the LLM extraction path that runs `extractOneShot` against
 * the resolved schema. Both `extractOneShot` and the API-key lookup are
 * mocked so the test is hermetic.
 */
import "../../../../../test/setup-keys";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateApiKey } from "@glyph/crypto";

// ---------------------------------------------------------------------------
// State + mocks (must precede the SUT import).
// ---------------------------------------------------------------------------

type KeyRow = {
  id: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  isActive: boolean;
  name: string;
};

const state: {
  keys: KeyRow[];
  limitSuccess: boolean;
  usageInserts: unknown[];
  keyUpdates: unknown[];
} = {
  keys: [],
  limitSuccess: true,
  usageInserts: [],
  keyUpdates: [],
};

vi.mock("@/db", () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            state.keys.length > 0 ? [state.keys[0]] : [],
        }),
      }),
    }),
    insert: () => ({
      values: async (v: unknown) => {
        state.usageInserts.push(v);
      },
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: async () => {
          state.keyUpdates.push(v);
        },
      }),
    }),
  };
  return { db };
});

vi.mock("@/lib/extract-ratelimit", () => ({
  getExtractLimiter: () => ({
    limit: async () => ({ success: state.limitSuccess }),
  }),
}));

const oneshotMock = vi.fn();
vi.mock("@/lib/extract/oneshot", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/extract/oneshot")
  >("@/lib/extract/oneshot");
  return {
    ...actual,
    extractOneShot: (args: unknown) =>
      oneshotMock(args) as ReturnType<typeof actual.extractOneShot>,
  };
});

// Import under test AFTER mocks.
import { POST } from "./route";
import { OneShotExtractError } from "@/lib/extract/oneshot";
import { SchemaNotFoundError } from "@/lib/extract/resolve-schema";
import type { NextRequest } from "next/server";

function jsonReq(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new Request("http://localhost/api/v1/extract", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function seedKey(): Promise<string> {
  const { raw, hash, prefix } = generateApiKey();
  state.keys = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      keyHash: hash,
      keyPrefix: prefix,
      isActive: true,
      name: "test",
    },
  ];
  return raw;
}

beforeEach(() => {
  state.keys = [];
  state.limitSuccess = true;
  state.usageInserts = [];
  state.keyUpdates = [];
  oneshotMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/extract — raw-text branch", () => {
  it("401 without Authorization", async () => {
    const res = await POST(
      jsonReq({ raw_text: "hello world", document_type: "resume" }),
    );
    expect(res.status).toBe(401);
  });

  it("200 returns the legacy response shape on success", async () => {
    const raw = await seedKey();
    const fakeJson = {
      document_type: "resume",
      schema_version: "1.0",
      full_name: "Ada Lovelace",
    };
    oneshotMock.mockResolvedValueOnce({
      json: fakeJson,
      episodes: [],
      usage: {
        promptTokens: 1,
        cachedTokens: 0,
        candidatesTokens: 1,
        totalTokens: 2,
      },
      costUsd: 0,
      schemaVersion: "builtin-v1-resume",
      sessionId: null,
    });

    const res = await POST(
      jsonReq(
        { raw_text: "Ada Lovelace, mathematician.", document_type: "resume" },
        { authorization: `Bearer ${raw}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document_type: string;
      schema_version: string;
      data: unknown;
      json_schema: unknown;
      signature_valid: boolean;
      extracted_at: string;
    };
    expect(body.document_type).toBe("resume");
    expect(body.schema_version).toBe("1.0");
    expect(body.data).toEqual(fakeJson);
    expect(body.signature_valid).toBe(false);
    expect(typeof body.extracted_at).toBe("string");
    expect(body.json_schema).toBeTruthy();

    // userId scoping passed to extractOneShot.
    const callArg = oneshotMock.mock.calls[0]![0] as { userId: string };
    expect(callArg.userId).toBe(state.keys[0]!.userId);

    // Usage bookkeeping ran.
    expect(state.usageInserts.length).toBe(1);
    expect(state.keyUpdates.length).toBe(1);
  });

  it("400 bad_request when typeKey resolution fails", async () => {
    const raw = await seedKey();
    oneshotMock.mockRejectedValueOnce(
      new SchemaNotFoundError("does_not_exist"),
    );
    const res = await POST(
      jsonReq(
        { raw_text: "anything", document_type: "does_not_exist" },
        { authorization: `Bearer ${raw}` },
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
  });

  it("502 when the extraction stream fails", async () => {
    const raw = await seedKey();
    oneshotMock.mockRejectedValueOnce(
      new OneShotExtractError("stream_error", "rate_limit"),
    );
    const res = await POST(
      jsonReq(
        { raw_text: "hi there", document_type: "resume" },
        { authorization: `Bearer ${raw}` },
      ),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("extract_failed");
  });

  it("429 when rate limiter denies (raw-text body)", async () => {
    const raw = await seedKey();
    state.limitSuccess = false;
    const res = await POST(
      jsonReq(
        { raw_text: "x", document_type: "resume" },
        { authorization: `Bearer ${raw}` },
      ),
    );
    expect(res.status).toBe(429);
    expect(oneshotMock).not.toHaveBeenCalled();
  });
});
