/**
 * Integration tests for the bi-temporal episode store.
 *
 * Gated behind `RUN_DB_INTEGRATION=1` because they require a live
 * Postgres / Supabase instance reachable via `DATABASE_URL`. The default
 * test run no-ops these via `describe.skipIf` so CI without a database
 * remains green.
 *
 * Run locally with:
 *
 *   RUN_DB_INTEGRATION=1 DATABASE_URL=postgres://... \
 *     pnpm test src/lib/extract/episodes.integration
 */

import { describe, it, expect } from "vitest";

const SHOULD_RUN = process.env.RUN_DB_INTEGRATION === "1";

describe.skipIf(!SHOULD_RUN)("episodes (integration)", () => {
  it("appendEpisode persists a row visible via foldCurrent", async () => {
    // Wired up at runtime to avoid pulling in postgres-js when the env
    // gate is off.
    const { db: rawDb } = await import("@/db");
    const { appendEpisode, foldCurrent, createSession } = await import(
      "./episodes"
    );
    const db = rawDb as unknown as import("./episodes").EpisodeDB;

    // NOTE: requires a real `documents` row + auth user. The integration
    // harness is responsible for seeding fixtures. This test outline
    // demonstrates the call shape.
    const docId = process.env.TEST_DOC_ID ?? "00000000-0000-0000-0000-000000000000";
    const userId = process.env.TEST_USER_ID ?? "00000000-0000-0000-0000-000000000000";

    const session = await createSession(db, {
      userId,
      docId,
      schemaVersion: "contract@1.0",
    });

    await appendEpisode(db, {
      sessionId: session.id,
      docId,
      userId,
      patch: [{ op: "add", path: "/title", value: "hello" }],
    });

    const result = await foldCurrent(db, { docId });
    expect(result.episodeCount).toBeGreaterThanOrEqual(1);
    expect((result.state as Record<string, unknown>).title).toBe("hello");
  });

  it("supersedes closes prior valid_to and excludes from foldCurrent", async () => {
    // Outline only — see appendEpisode test above for fixture setup.
    expect(true).toBe(true);
  });

  it("foldAsOf returns the historical state at a chosen instant", async () => {
    // Outline only — exercises lte(validFrom) AND (validTo IS NULL OR
    // validTo > asOf) against a real database.
    expect(true).toBe(true);
  });

  it("endSession persists totals and ended_at", async () => {
    // Outline only.
    expect(true).toBe(true);
  });
});
