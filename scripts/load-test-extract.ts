/**
 * Load test scaffold for the SSE extraction endpoint.
 *
 * NOT run in CI. Invoke manually against a deployed env:
 *
 *   pnpm tsx scripts/load-test-extract.ts \
 *       --target https://glyph.app/api/extract/stream \
 *       --users 50 --docs-per-user 3 --duration 60s \
 *       --auth-token "<supabase JWT>"
 *
 * Reports:
 *   - p50 / p95 / p99 stream-completion latency (ms)
 *   - success rate
 *   - mutex contention (count of 409 responses)
 *   - cost-cap hits (count of 402 responses)
 *   - tokens/sec aggregate
 *
 * The script is intentionally dependency-free beyond Node built-ins so
 * it can run from any workstation. It is NOT a substitute for
 * production-grade load testing (k6, vegeta) — it's a smoke harness.
 */

import { setTimeout as sleep } from "node:timers/promises";

interface Args {
  target: string;
  users: number;
  docsPerUser: number;
  durationSec: number;
  authToken?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const eqIdx = argv.findIndex((a) => a.startsWith(`--${k}=`));
    if (eqIdx >= 0) return argv[eqIdx].slice(k.length + 3);
    const i = argv.indexOf(`--${k}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      return argv[i + 1];
    }
    return undefined;
  };
  const dur = get("duration") ?? "60s";
  const m = /^(\d+)(s|m)?$/.exec(dur);
  const durationSec = m ? Number(m[1]) * (m[2] === "m" ? 60 : 1) : 60;
  return {
    target: get("target") ?? "http://localhost:3000/api/extract/stream",
    users: Number(get("users") ?? 10),
    docsPerUser: Number(get("docs-per-user") ?? 1),
    durationSec,
    authToken: get("auth-token"),
  };
}

interface Sample {
  ms: number;
  status: number;
  tokens: number;
}

const samples: Sample[] = [];
let sent = 0;
let mutexContentions = 0;
let capHits = 0;

function syntheticDelta(): string {
  // Boring but realistic chunk so the model has something to anchor to.
  return (
    "Effective Date: April 29, 2026. Parties: Acme Corp and Beta Inc. " +
    "This Master Services Agreement governs all work orders issued hereunder."
  );
}

async function runOne(
  target: string,
  authToken: string | undefined,
  docId: string,
): Promise<void> {
  const t0 = Date.now();
  let status = 0;
  let tokens = 0;
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        docId,
        schemaType: "contract",
        textDelta: syntheticDelta(),
        clientSeq: Math.floor(Math.random() * 1e9),
      }),
    });
    status = res.status;
    if (status === 409) mutexContentions++;
    if (status === 402) capHits++;
    if (status === 200 && res.body) {
      const reader = res.body.getReader();
      const td = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += td.decode(value, { stream: true });
        // Parse usage events for token count.
        for (const block of buf.split("\n\n")) {
          if (block.includes("event: usage")) {
            const m = /data: (\{.*\})/.exec(block);
            if (m) {
              try {
                const obj = JSON.parse(m[1]) as { totalTokens?: number };
                if (typeof obj.totalTokens === "number") tokens += obj.totalTokens;
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
    }
  } catch {
    status = 0;
  }
  samples.push({ ms: Date.now() - t0, status, tokens });
  sent++;
}

function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stopAt = Date.now() + args.durationSec * 1000;
  console.log(
    `[load-test] target=${args.target} users=${args.users} docs/user=${args.docsPerUser} duration=${args.durationSec}s`,
  );

  const userTasks: Array<Promise<void>> = [];
  for (let u = 0; u < args.users; u++) {
    userTasks.push(
      (async () => {
        const userIx = u;
        let i = 0;
        while (Date.now() < stopAt) {
          const docIx = i % args.docsPerUser;
          const docId = `00000000-0000-0000-0000-${userIx
            .toString()
            .padStart(6, "0")}${docIx.toString().padStart(6, "0")}`;
          await runOne(args.target, args.authToken, docId);
          i++;
          // small jitter so users don't perfectly synchronise
          await sleep(50 + Math.random() * 200);
        }
      })(),
    );
  }
  await Promise.all(userTasks);

  const ok = samples.filter((s) => s.status === 200);
  const successRate = sent === 0 ? 0 : ok.length / sent;
  const lats = ok.map((s) => s.ms);
  const totalTokens = samples.reduce((a, s) => a + s.tokens, 0);
  const tps = totalTokens / args.durationSec;

  console.log(
    JSON.stringify(
      {
        sent,
        ok: ok.length,
        successRate: Number(successRate.toFixed(4)),
        latency: {
          p50: quantile(lats, 0.5),
          p95: quantile(lats, 0.95),
          p99: quantile(lats, 0.99),
        },
        mutexContentions,
        capHits,
        tokensPerSec: Number(tps.toFixed(2)),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
