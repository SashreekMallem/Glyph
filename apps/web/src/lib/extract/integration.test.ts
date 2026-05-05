/**
 * Integration tests for the extraction pipeline.
 *
 * Gated: only runs when `RUN_INTEGRATION=1` is set. The CI default is
 * unset, so this file effectively skips itself.
 *
 * Coverage:
 *   1. End-to-end: createSession → 5 patch events → fold → final state.
 *   2. Bi-temporal: episodes at different valid_from, foldAsOf returns
 *      the snapshot that was valid at each instant.
 *   3. Cost-cap: synthetic usage ratchets the Redis counter; checkDailyCap
 *      returns ok=false at threshold.
 *
 * The DB is a real Supabase test project (env-gated). Gemini is always
 * mocked — we don't burn tokens in CI even when integration mode is on.
 */

import { describe, it, expect, beforeAll } from "vitest";

const RUN = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration("extraction pipeline integration", () => {
  beforeAll(() => {
    if (!process.env.SUPABASE_TEST_DB_URL) {
      throw new Error(
        "RUN_INTEGRATION=1 but SUPABASE_TEST_DB_URL is unset. " +
          "Point this at a disposable test branch.",
      );
    }
  });

  it("end-to-end: 5 patches → fold → final state", async () => {
    const { appendEpisode, foldCurrent, createSession, endSession } =
      await import("./episodes");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.SUPABASE_TEST_DB_URL!);
    const db = drizzle(sql) as unknown as Parameters<typeof appendEpisode>[0];

    const docId = `00000000-0000-0000-0000-${Date.now().toString().slice(-12).padStart(12, "0")}`;
    const userId = "00000000-0000-0000-0000-000000000abc";

    const sess = await createSession(db, {
      userId,
      docId,
      schemaVersion: "test-v1",
    });

    const patches = [
      [{ op: "add", path: "/title", value: "T" }],
      [{ op: "add", path: "/year", value: 2026 }],
      [{ op: "add", path: "/parties", value: [] }],
      [{ op: "add", path: "/parties/0", value: { name: "Alice" } }],
      [{ op: "add", path: "/parties/1", value: { name: "Bob" } }],
    ];
    for (const p of patches) {
      await appendEpisode(db, {
        sessionId: sess.id,
        docId,
        userId,
        patch: p as never,
      });
    }
    await endSession(db, { sessionId: sess.id, status: "succeeded" });

    const fold = await foldCurrent(db, { docId });
    expect(fold.state).toEqual({
      title: "T",
      year: 2026,
      parties: [{ name: "Alice" }, { name: "Bob" }],
    });
    expect(fold.episodeCount).toBe(5);

    await sql.end();
  });

  it("bi-temporal: foldAsOf returns the snapshot valid at the instant", async () => {
    const { appendEpisode, foldAsOf, createSession } = await import("./episodes");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.SUPABASE_TEST_DB_URL!);
    const db = drizzle(sql) as unknown as Parameters<typeof appendEpisode>[0];

    const docId = `bi-${Date.now()}`;
    const userId = "00000000-0000-0000-0000-000000000bcd";
    const sess = await createSession(db, {
      userId,
      docId,
      schemaVersion: "test-v1",
    });

    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-06-01T00:00:00Z");

    await appendEpisode(db, {
      sessionId: sess.id,
      docId,
      userId,
      patch: [{ op: "add", path: "/title", value: "Old" }] as never,
      validFrom: t0,
    });
    await appendEpisode(db, {
      sessionId: sess.id,
      docId,
      userId,
      patch: [{ op: "replace", path: "/title", value: "New" }] as never,
      validFrom: t1,
    });

    const earlySnap = await foldAsOf(db, {
      docId,
      asOf: new Date("2026-03-01T00:00:00Z"),
    });
    expect((earlySnap.state as { title: string }).title).toBe("Old");

    const lateSnap = await foldAsOf(db, {
      docId,
      asOf: new Date("2026-07-01T00:00:00Z"),
    });
    expect((lateSnap.state as { title: string }).title).toBe("New");

    await sql.end();
  });

  it("cost cap trips at threshold via redis counter", async () => {
    const { Redis } = await import("@upstash/redis");
    const { checkDailyCap, userCostKey } = await import("./cost");

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("Upstash creds required for cost-cap integration test");
    }
    const redis = new Redis({ url, token });
    const userId = `int-test-${Date.now()}`;
    const key = userCostKey(userId);

    try {
      await redis.set(key, 999_999, { ex: 60 }); // $0.999999
      const r1 = await checkDailyCap(redis, { userId, capUsd: 1.0 });
      expect(r1.ok).toBe(true);

      await redis.set(key, 1_000_000, { ex: 60 }); // $1.00 — at cap.
      const r2 = await checkDailyCap(redis, { userId, capUsd: 1.0 });
      expect(r2.ok).toBe(false);
    } finally {
      await redis.del(key);
    }
  });
});
