import "./setup-keys";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptPayload, signPayload, generateApiKey } from "@glyph/crypto";

// ---------------------------------------------------------------------------
// Mocks
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
  // Minimal Drizzle-shaped stub: only the calls the route makes are supported.
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (_n: number) => {
            // Looks up api_keys by prefix. The route calls .where(eq(apiKeys.keyPrefix, prefix))
            // which we can't inspect here; but since we only use this path for
            // the key lookup, return the single active matching key record.
            return state.keys.length > 0 ? [state.keys[0]] : [];
          },
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

// Import under test AFTER mocks are registered.
import { POST } from "@/app/api/v1/extract/route";
import type { NextRequest } from "next/server";

function jsonReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
  return new Request("http://localhost/api/v1/extract", init) as unknown as NextRequest;
}

const validContract = {
  document_type: "contract" as const,
  schema_version: "1.0",
  parties: [
    { name: "Acme Inc", role: "client" as const },
    { name: "Beta LLC", role: "vendor" as const },
  ],
  effective_date: "2025-01-01",
  obligations: [
    { party: "Acme Inc", description: "Pay invoice on time" },
  ],
  governing_law: "Delaware",
  confidentiality: false,
};

async function makeEncryptedPayload(data: object) {
  const { encrypted, iv, tag } = await encryptPayload(data);
  const signature = await signPayload(encrypted);
  return { encrypted, iv, tag, signature };
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/extract", () => {
  it("401 without Authorization header", async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(401);
  });

  it("401 for unknown API key", async () => {
    state.keys = [];
    const res = await POST(
      jsonReq({}, { authorization: "Bearer sk_live_deadbeefdeadbeef" }),
    );
    expect(res.status).toBe(401);
  });

  it("400 decryption_failed when ciphertext is tampered", async () => {
    const raw = await seedKey();
    const enc = await makeEncryptedPayload(validContract);
    // Flip a byte of the ciphertext
    const tampered = {
      ...enc,
      encrypted: Buffer.from(
        Buffer.from(enc.encrypted, "base64").map((b, i) => (i === 0 ? b ^ 0xff : b)),
      ).toString("base64"),
      document_type: "contract",
    };
    const res = await POST(
      jsonReq(tampered, { authorization: `Bearer ${raw}` }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("decryption_failed");
  });

  it("400 validation_failed when decrypted payload does not match schema", async () => {
    const raw = await seedKey();
    // Encrypt a payload that decrypts to invalid contract (missing fields)
    const enc = await makeEncryptedPayload({
      document_type: "contract",
      schema_version: "1.0",
      parties: [], // invalid: min 2
      effective_date: "2025-01-01",
      obligations: [],
      governing_law: "Delaware",
    });
    const res = await POST(
      jsonReq(
        { ...enc, document_type: "contract" },
        { authorization: `Bearer ${raw}` },
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  it("200 with expected shape for a valid payload", async () => {
    const raw = await seedKey();
    const enc = await makeEncryptedPayload(validContract);
    const res = await POST(
      jsonReq(
        { ...enc, document_type: "contract" },
        { authorization: `Bearer ${raw}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document_type: string;
      schema_version: string;
      data: { parties: unknown[] };
      json_schema: unknown;
      signature_valid: boolean;
      extracted_at: string;
    };
    expect(body.document_type).toBe("contract");
    expect(body.schema_version).toBe("1.0");
    expect(body.signature_valid).toBe(true);
    expect(Array.isArray(body.data.parties)).toBe(true);
    expect(body.json_schema).toBeTruthy();
    expect(typeof body.extracted_at).toBe("string");
    expect(state.usageInserts.length).toBe(1);
    expect(state.keyUpdates.length).toBe(1);
  });

  it("429 when rate limiter denies", async () => {
    const raw = await seedKey();
    state.limitSuccess = false;
    const enc = await makeEncryptedPayload(validContract);
    const res = await POST(
      jsonReq(
        { ...enc, document_type: "contract" },
        { authorization: `Bearer ${raw}` },
      ),
    );
    expect(res.status).toBe(429);
  });

  it("403 when key is revoked", async () => {
    const raw = await seedKey();
    state.keys[0]!.isActive = false;
    const res = await POST(jsonReq({}, { authorization: `Bearer ${raw}` }));
    expect(res.status).toBe(403);
  });

  it("400 when multipart body is malformed", async () => {
    const raw = await seedKey();
    const req = new Request("http://localhost/api/v1/extract", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=xxx",
        authorization: `Bearer ${raw}`,
      },
      body: "--xxx--",
    }) as unknown as NextRequest;
    const res = await POST(req);
    // Either the runtime rejects the malformed body (400 bad_request) or
    // accepts it with no `file` field (also 400 bad_request).
    expect(res.status).toBe(400);
  });
});
