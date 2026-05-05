import "./setup-keys";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encryptPayload,
  signPayload,
  fingerprintFields,
  fingerprintText,
} from "@glyph/crypto";

import { syncDocument } from "../src/server/sync";
import { attachMeta } from "../src/lib/payload-meta";
import type { EmbeddedFields } from "../src/lib/sync/file-io";

vi.mock("../src/lib/extract/oneshot", () => ({
  extractOneShot: vi.fn(async ({ onlyPaths }: { onlyPaths?: string[] }) => ({
    json: { name: "Jane Smith" },
    episodes: [],
    usage: { promptTokens: 0, cachedTokens: 0, candidatesTokens: 0, totalTokens: 0 },
    costUsd: null,
    schemaVersion: "1.0",
    sessionId: null,
    regions: onlyPaths?.includes("name") ? { name: [0, 10] as [number, number] } : {},
  })),
}));

const TEXT = "John Smith works at Acme Corp";
const REGIONS = {
  name: [0, 10] as [number, number],
  company: [20, 29] as [number, number],
};

async function buildFields(
  data: Record<string, unknown>,
  text: string,
  regions: Record<string, [number, number]>,
): Promise<EmbeddedFields> {
  const meta = {
    fingerprints: fingerprintFields(text, regions),
    regions,
    sourceTextHash: fingerprintText(text),
    schemaVersion: "1.0",
    blockIds: null,
    compositionId: null,
    signedAt: "2026-05-05T00:00:00.000Z",
  };
  const withMeta = attachMeta(data, meta);
  const enc = await encryptPayload(withMeta);
  const sig = await signPayload(enc.encrypted);
  return {
    encrypted: enc.encrypted,
    iv: enc.iv,
    tag: enc.tag,
    signature: sig,
    documentType: "resume",
    schemaVersion: "1.0",
    timestamp: meta.signedAt,
    compositionId: null,
    blockIds: null,
  };
}

describe("syncDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no_payload when embedded is null", async () => {
    const r = await syncDocument({
      visibleText: TEXT,
      embedded: null,
      userId: "u1",
    });
    expect(r.status).toBe("no_payload");
    expect(r.data).toBeNull();
    expect(r.newEmbedded).toBeNull();
  });

  it("in_sync when fingerprints match current text", async () => {
    const fields = await buildFields(
      { name: "John Smith", company: "Acme Corp" },
      TEXT,
      REGIONS,
    );
    const r = await syncDocument({
      visibleText: TEXT,
      embedded: fields,
      userId: "u1",
    });
    expect(r.status).toBe("in_sync");
    expect(r.signatureValid).toBe(true);
    expect(r.drift?.hasDrift).toBe(false);
    expect(r.newEmbedded).toBeNull();
    expect((r.data as { name: string }).name).toBe("John Smith");
  });

  it("synced when a field drifted: re-extracts and produces newEmbedded", async () => {
    const fields = await buildFields(
      { name: "John Smith", company: "Acme Corp" },
      TEXT,
      REGIONS,
    );
    const editedText = "Jane Smith works at Acme Corp";
    const r = await syncDocument({
      visibleText: editedText,
      embedded: fields,
      userId: "u1",
    });
    expect(r.status).toBe("synced");
    expect(r.drift?.changed).toEqual(["name"]);
    expect(r.newEmbedded).not.toBeNull();
    expect(r.newEmbedded!.encrypted).not.toBe(fields.encrypted);
    expect((r.data as { name: string }).name).toBe("Jane Smith");
  });

  it("in_sync when payload has no _meta (legacy) — returns data, no rebundle", async () => {
    const enc = await encryptPayload({ name: "Legacy", company: "Old" });
    const sig = await signPayload(enc.encrypted);
    const fields: EmbeddedFields = {
      encrypted: enc.encrypted,
      iv: enc.iv,
      tag: enc.tag,
      signature: sig,
      documentType: "resume",
      schemaVersion: "1.0",
      compositionId: null,
      blockIds: null,
    };
    const r = await syncDocument({
      visibleText: TEXT,
      embedded: fields,
      userId: "u1",
    });
    expect(r.status).toBe("in_sync");
    expect(r.meta).toBeNull();
    expect((r.data as { name: string }).name).toBe("Legacy");
  });

  it("decryption_failed when ciphertext is tampered", async () => {
    const fields = await buildFields(
      { name: "John" },
      TEXT,
      { name: REGIONS.name },
    );
    const tampered: EmbeddedFields = {
      ...fields,
      encrypted: fields.encrypted.slice(0, -4) + "ZZZZ",
    };
    const r = await syncDocument({
      visibleText: TEXT,
      embedded: tampered,
      userId: "u1",
    });
    expect(r.status).toBe("decryption_failed");
  });
});
