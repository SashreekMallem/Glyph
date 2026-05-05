import { describe, it, expect } from "vitest";
import { regionsFromOps } from "../src/regions.js";
import type { RFC6902Op } from "../src/types.js";

describe("regionsFromOps", () => {
  it("converts JSON pointer paths to dot notation", () => {
    const ops: RFC6902Op[] = [
      { op: "add", path: "/personal/full_name", value: "John", srcStart: 0, srcEnd: 4 },
      { op: "add", path: "/experience/0/company", value: "Acme", srcStart: 10, srcEnd: 14 },
    ];
    expect(regionsFromOps(ops)).toEqual({
      "personal.full_name": [0, 4],
      "experience.0.company": [10, 14],
    });
  });

  it("last-writer-wins on duplicate paths", () => {
    const ops: RFC6902Op[] = [
      { op: "add", path: "/email", value: "a@x", srcStart: 0, srcEnd: 3 },
      { op: "replace", path: "/email", value: "b@y", srcStart: 50, srcEnd: 53 },
    ];
    expect(regionsFromOps(ops)).toEqual({ email: [50, 53] });
  });

  it("ops without spans are skipped", () => {
    const ops: RFC6902Op[] = [
      { op: "add", path: "/personal", value: {} },
      { op: "add", path: "/personal/email", value: "a@x", srcStart: 5, srcEnd: 8 },
    ];
    expect(regionsFromOps(ops)).toEqual({ "personal.email": [5, 8] });
  });

  it("invalid spans are dropped", () => {
    const ops: RFC6902Op[] = [
      { op: "add", path: "/a", value: 1, srcStart: -1, srcEnd: 5 },
      { op: "add", path: "/b", value: 2, srcStart: 10, srcEnd: 5 }, // reversed
      { op: "add", path: "/c", value: 3, srcStart: 1, srcEnd: 4 },
    ];
    expect(regionsFromOps(ops)).toEqual({ c: [1, 4] });
  });

  it("remove/move/copy ops contribute nothing", () => {
    const ops: RFC6902Op[] = [
      { op: "remove", path: "/a", srcStart: 0, srcEnd: 5 } as RFC6902Op,
      { op: "move", from: "/a", path: "/b", srcStart: 0, srcEnd: 5 } as RFC6902Op,
      { op: "copy", from: "/a", path: "/c", srcStart: 0, srcEnd: 5 } as RFC6902Op,
    ];
    expect(regionsFromOps(ops)).toEqual({});
  });

  it("unescapes RFC 6901 tokens", () => {
    const ops: RFC6902Op[] = [
      { op: "add", path: "/a~1b/c~0d", value: "x", srcStart: 0, srcEnd: 1 },
    ];
    expect(regionsFromOps(ops)).toEqual({ "a/b.c~d": [0, 1] });
  });
});
