import { describe, expect, it } from "vitest";

import {
  CHUNK_SIZE,
  chunkString,
  reassembleChunks,
} from "./pure/chunking.js";

describe("chunkString", () => {
  it("returns a single chunk for strings shorter than the limit", () => {
    const s = "a".repeat(50);
    const chunks = chunkString(s);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(s);
  });

  it("returns a single chunk at exactly CHUNK_SIZE", () => {
    const s = "x".repeat(CHUNK_SIZE);
    const chunks = chunkString(s);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(s);
  });

  it("splits a 250-char payload into 3 chunks (120 + 120 + 10) at size 120", () => {
    const s = "z".repeat(250);
    const chunks = chunkString(s, 120);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.length).toBe(120);
    expect(chunks[1]?.length).toBe(120);
    expect(chunks[2]?.length).toBe(10);
  });

  it("reassembles to the original string", () => {
    const s = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const chunks = chunkString(s, 37);
    expect(reassembleChunks(chunks)).toBe(s);
  });

  it("handles the empty string as a single empty chunk", () => {
    const chunks = chunkString("");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("");
    expect(reassembleChunks(chunks)).toBe("");
  });

  it("round-trips arbitrary base64 at the real Drive limit boundary", () => {
    // Simulate realistic encrypted base64 — just above the single-chunk limit.
    const s = "A".repeat(CHUNK_SIZE + 1);
    const chunks = chunkString(s);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.length).toBe(1);
    expect(reassembleChunks(chunks)).toBe(s);
  });
});
