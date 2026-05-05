import { describe, it, expect } from "vitest";
import { fingerprintText } from "@glyph/crypto";
import {
  attachMeta,
  buildMeta,
  stripMeta,
  type PayloadMeta,
} from "../src/lib/payload-meta";
import { canonicalize, canonicalStringify } from "../src/lib/canonicalize";

const TEXT = "John Smith works at Acme Corp";
const REGIONS = {
  name: [0, 10] as const,
  company: [20, 29] as const,
};

describe("buildMeta", () => {
  it("computes fingerprints for each region and hashes source text", () => {
    const meta = buildMeta({
      sourceText: TEXT,
      regions: REGIONS,
      schemaVersion: "1.0",
      now: () => new Date("2026-05-05T00:00:00Z"),
    });
    expect(meta.fingerprints.name).toBeDefined();
    expect(meta.fingerprints.company).toBeDefined();
    expect(meta.sourceTextHash).toBe(fingerprintText(TEXT));
    expect(meta.schemaVersion).toBe("1.0");
    expect(meta.signedAt).toBe("2026-05-05T00:00:00.000Z");
    expect(meta.blockIds).toBeNull();
    expect(meta.compositionId).toBeNull();
  });

  it("preserves blockIds and compositionId when given", () => {
    const meta = buildMeta({
      sourceText: TEXT,
      regions: REGIONS,
      schemaVersion: "1.0",
      blockIds: ["resume.base.v1", "resume.experience.v1"],
      compositionId: "abc-123",
    });
    expect(meta.blockIds).toEqual(["resume.base.v1", "resume.experience.v1"]);
    expect(meta.compositionId).toBe("abc-123");
  });

  it("empty regions produce empty fingerprints", () => {
    const meta = buildMeta({
      sourceText: TEXT,
      regions: {},
      schemaVersion: "1.0",
    });
    expect(meta.fingerprints).toEqual({});
    expect(meta.regions).toEqual({});
  });
});

describe("attachMeta + stripMeta", () => {
  it("round-trips data through attach + strip", () => {
    const data = { name: "John", email: "j@x.com" };
    const meta = buildMeta({
      sourceText: TEXT,
      regions: REGIONS,
      schemaVersion: "1.0",
    });
    const attached = attachMeta(data, meta);
    expect(attached._meta).toEqual(meta);
    const { data: rest, meta: pulled } = stripMeta(attached);
    expect(rest).toEqual(data);
    expect(pulled).toEqual(meta);
  });

  it("stripMeta returns null meta when not present", () => {
    const { data, meta } = stripMeta({ a: 1, b: 2 });
    expect(meta).toBeNull();
    expect(data).toEqual({ a: 1, b: 2 });
  });

  it("stripMeta returns null when _meta is malformed", () => {
    const result = stripMeta({ a: 1, _meta: "not-an-object" } as unknown as Record<string, unknown>);
    expect(result.meta).toBeNull();
  });
});

describe("_meta survives canonicalize", () => {
  it("canonical form preserves _meta with sorted inner keys", () => {
    const data = { z: 1, a: 2 };
    const meta: PayloadMeta = {
      fingerprints: { a: "deadbeef00000000" },
      regions: { a: [0, 5] },
      sourceTextHash: "f0e0d0c0b0a09080",
      schemaVersion: "1.0",
      blockIds: ["x.v1"],
      compositionId: null,
      signedAt: "2026-05-05T00:00:00.000Z",
    };
    const attached = attachMeta(data, meta);
    const canon = canonicalize(attached) as Record<string, unknown>;
    expect(Object.keys(canon)).toEqual(["_meta", "a", "z"]);
    const stringForm = canonicalStringify(attached);
    expect(stringForm).toContain('"_meta"');
    expect(stringForm).toContain('"sourceTextHash":"f0e0d0c0b0a09080"');
  });
});
