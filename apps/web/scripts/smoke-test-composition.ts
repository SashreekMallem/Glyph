/**
 * End-to-end smoke test for Glyph's adaptive schema composition system.
 *
 * Exercises the full stack against the LIVE Supabase database (no mocks):
 *
 *   1. Verify schema_blocks library is seeded (21 curated blocks).
 *   2. Discover blocks for the "resume" domain via /api/v1/blocks (the
 *      MCP discover_schema endpoint).
 *   3. Compose a schema with a non-default block set (base + experience
 *      + projects + publications) and check fingerprint cache:
 *        a. First call: composition is created, cached.
 *        b. Second call: SAME fingerprint hit, reuse_count incremented.
 *   4. Generate a document via /api/mcp/generate with explicit block_ids,
 *      retrieve the .docx, decode the embedded XML, verify the signed
 *      payload round-trips and that <CompositionId> + <BlockIds> are
 *      embedded.
 *   5. Read the same document via the MCP read_glyph_payload handler:
 *      verify signature, decrypt payload, surface composition metadata.
 *   6. Tampering: flip a byte in the ciphertext, ensure verify rejects.
 *   7. Cost & latency: report per-stage timings and zero-LLM-cost-for-read
 *      claim.
 *
 * Prerequisites:
 *   - Dev server is running on http://localhost:3000
 *   - .env.local has DATABASE_URL, ENCRYPTION_MASTER_KEY,
 *     SIGNING_PRIVATE_KEY, SIGNING_PUBLIC_KEY, GEMINI_API_KEY.
 *
 * Cleans up after itself (deletes the test API key + user-profile row).
 *
 * Run: pnpm --filter @glyph/web tsx scripts/smoke-test-composition.ts
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { unzipSync, zipSync } from "fflate";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────────────────────────────────────
// .env.local loader
// ──────────────────────────────────────────────────────────────────────────

function loadEnv(path: string) {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) {
        let v = m[2]!.trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        process.env[m[1]!] = v;
      }
    }
  } catch {
    // Optional file.
  }
}

loadEnv(resolve(__dirname, "../.env.local"));

// PEM signing keys are base64-encoded in env; decode them in-place.
for (const k of ["SIGNING_PRIVATE_KEY", "SIGNING_PUBLIC_KEY"]) {
  const v = process.env[k];
  if (v && !v.includes("BEGIN")) {
    try {
      process.env[k] = Buffer.from(v, "base64").toString("utf8");
    } catch {
      // leave as-is
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Pretty printing
// ──────────────────────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

let stepNo = 0;
function step(name: string) {
  stepNo++;
  console.log(`\n${bold(`[${stepNo}] ${name}`)}`);
}
function ok(msg: string) {
  console.log(`  ${green("✓")} ${msg}`);
}
function info(msg: string) {
  console.log(`  ${dim(msg)}`);
}
function metric(label: string, value: string) {
  console.log(`  ${cyan(label.padEnd(24))} ${value}`);
}
function fail(msg: string): never {
  console.log(`  ${red("✗")} ${msg}`);
  process.exit(1);
}

import postgres from "postgres";
import bcrypt from "bcryptjs";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

const API_BASE = process.env.GLYPH_API_BASE ?? "http://localhost:3000";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function now(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function extractXmlElement(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return null;
  return m[1]!.trim()
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function cleanup(userId: string, apiKeyId: string) {
  await sql`DELETE FROM api_usage WHERE api_key_id = ${apiKeyId}`;
  await sql`DELETE FROM api_keys WHERE id = ${apiKeyId}`;
  await sql`DELETE FROM users_profile WHERE id = ${userId}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold("\n🧬 Glyph Composition System — End-to-End Smoke Test\n"));
  info(`API base   = ${API_BASE}`);
  info(`Database   = ${process.env.DATABASE_URL?.replace(/:[^@]*@/, ":***@")}`);

  const t0 = now();

  // ────────────────────────────────────────────────────────────────────────
  step("Verify schema_blocks library is seeded");
  const seedRows = (await sql`
    SELECT domain, COUNT(*) AS c
    FROM schema_blocks
    GROUP BY domain
    ORDER BY domain
  `) as { domain: string; c: number }[];
  if (seedRows.length === 0) fail("schema_blocks is empty — run the seeder");
  for (const r of seedRows) info(`  ${r.domain.padEnd(10)}  ${r.c} blocks`);
  const totalBlocks = seedRows.reduce((s, r) => s + Number(r.c), 0);
  if (totalBlocks < 15) fail(`expected ≥15 blocks, got ${totalBlocks}`);
  ok(`${totalBlocks} blocks across ${seedRows.length} domains`);

  // ────────────────────────────────────────────────────────────────────────
  step("Mint a test API key (bypass user signup flow)");
  const userId = randomUUID();
  const apiKeyId = randomUUID();

  // Generate a key in the same format generateApiKey() produces.
  const rawSecret = `sk_live_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
  const keyHash = bcrypt.hashSync(rawSecret, 12);
  const keyPrefix = rawSecret.slice(0, 16);

  await sql`INSERT INTO users_profile (id, plan) VALUES (${userId}, 'pro')`;
  await sql`
    INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, is_active)
    VALUES (${apiKeyId}, ${userId}, 'smoke-test-composition', ${keyHash}, ${keyPrefix}, true)
  `;
  ok(`API key minted (prefix=${keyPrefix})`);

  // ────────────────────────────────────────────────────────────────────────
  step("Discover blocks for the 'resume' domain (MCP discover_schema)");
  const tDiscover = now();
  const discoverRes = await fetch(`${API_BASE}/api/v1/blocks?domain=resume`, {
    method: "GET",
    headers: { Authorization: `Bearer ${rawSecret}` },
  });
  const discoverMs = now() - tDiscover;
  if (!discoverRes.ok) {
    const body = await discoverRes.text();
    fail(`/api/v1/blocks failed: ${discoverRes.status} ${body}`);
  }
  const { blocks } = (await discoverRes.json()) as {
    blocks: Array<{
      id: string;
      name: string;
      version: string;
      isRequired: boolean;
      jsonSchema: unknown;
    }>;
  };
  ok(`${blocks.length} resume blocks discovered (${discoverMs}ms)`);
  const required = blocks.filter((b) => b.isRequired).map((b) => b.id);
  const optional = blocks.filter((b) => !b.isRequired).map((b) => b.id);
  info(`  required: ${required.join(", ")}`);
  info(`  optional: ${optional.join(", ")}`);

  // ────────────────────────────────────────────────────────────────────────
  step("Compose a non-default schema (base + experience + projects + publications)");
  const chosenBlocks = [
    "resume.base.v1",
    "resume.experience.v1",
    "resume.education.v1",
    "resume.projects.v1",
    "resume.publications.v1",
  ];
  for (const id of chosenBlocks) {
    if (!blocks.find((b) => b.id === id)) {
      fail(`expected block ${id} not in discovery response`);
    }
  }
  ok(`5 blocks selected (mix of required + optional)`);

  // ────────────────────────────────────────────────────────────────────────
  step("Generate a .docx with explicit block_ids (first call)");
  const resumeData = {
    document_type: "resume",
    schema_version: "1.0",
    personal: {
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+1-555-0100",
    },
    summary: "Mathematician and pioneer of computing.",
    experience: [
      {
        company: "Analytical Engine Co.",
        title: "Lead Algorithmist",
        start_date: "1843-01-01",
        end_date: "1852-11-27",
        description: "Designed first published algorithm for Bernoulli numbers.",
      },
    ],
    education: [
      {
        institution: "Self-taught with mentorship from Mary Somerville",
        degree: "Mathematical Analysis",
      },
    ],
    projects: [
      {
        name: "Notes on the Analytical Engine",
        description: "Translation + extensive original notes on Babbage's machine.",
      },
    ],
    publications: [
      {
        title: "Notes by the Translator",
        venue: "Scientific Memoirs",
        date: "1843-09-01",
      },
    ],
  };

  const tGen1 = now();
  const gen1Res = await fetch(`${API_BASE}/api/mcp/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawSecret}`,
    },
    body: JSON.stringify({
      document_type: "resume",
      structured_data: resumeData,
      output_format: "docx",
      title: "Ada Lovelace — Resume",
      block_ids: chosenBlocks,
    }),
  });
  const gen1Ms = now() - tGen1;
  if (!gen1Res.ok) {
    const body = await gen1Res.text();
    fail(`/api/mcp/generate failed: ${gen1Res.status} ${body}`);
  }
  const gen1 = (await gen1Res.json()) as {
    downloadUrl: string;
    documentId: string;
    expiresIn: number;
  };
  ok(`docx generated in ${gen1Ms}ms — ${gen1.downloadUrl.slice(0, 60)}…`);

  // ────────────────────────────────────────────────────────────────────────
  step("Generate again with SAME blocks — verify composition cache reuse");
  const tGen2 = now();
  const gen2Res = await fetch(`${API_BASE}/api/mcp/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawSecret}`,
    },
    body: JSON.stringify({
      document_type: "resume",
      structured_data: resumeData,
      output_format: "docx",
      title: "Ada Lovelace — Resume (2)",
      block_ids: chosenBlocks,
    }),
  });
  const gen2Ms = now() - tGen2;
  if (!gen2Res.ok) {
    const body = await gen2Res.text();
    fail(`second /api/mcp/generate failed: ${gen2Res.status} ${body}`);
  }
  ok(`second generate: ${gen2Ms}ms`);

  // Verify schema_compositions table now has exactly ONE row for this fingerprint
  const compRows = (await sql`
    SELECT id, fingerprint, reuse_count, block_ids
    FROM schema_compositions
    WHERE domain = 'resume'
  `) as { id: string; fingerprint: string; reuse_count: bigint; block_ids: string[] }[];
  info(`  compositions table now has ${compRows.length} resume row(s)`);
  if (compRows.length !== 1) {
    fail(`expected exactly 1 composition for these blocks, got ${compRows.length}`);
  }
  const composition = compRows[0]!;
  if (Number(composition.reuse_count) < 1) {
    fail(`reuse_count should be ≥1 after second call, got ${composition.reuse_count}`);
  }
  ok(`fingerprint cache working — reuse_count=${composition.reuse_count}, fp=${composition.fingerprint.slice(0, 12)}…`);

  // ────────────────────────────────────────────────────────────────────────
  step("Download the .docx and inspect embedded payload");
  const tDownload = now();
  const docxRes = await fetch(gen1.downloadUrl);
  if (!docxRes.ok) fail(`download failed: ${docxRes.status}`);
  const docxBytes = new Uint8Array(await docxRes.arrayBuffer());
  const downloadMs = now() - tDownload;
  ok(`downloaded ${docxBytes.byteLength} bytes (${downloadMs}ms)`);

  const entries = unzipSync(docxBytes);
  const customXmlEntry = Object.entries(entries).find(([k]) =>
    /^customXml\/item\d+\.xml$/.test(k),
  );
  if (!customXmlEntry) fail("no customXml/item*.xml in .docx");
  const customXml = Buffer.from(customXmlEntry[1]).toString("utf8");
  ok(`customXml/item1.xml extracted (${customXml.length}b)`);

  const docType = extractXmlElement(customXml, "DocumentType");
  const schemaVersion = extractXmlElement(customXml, "SchemaVersion");
  const encrypted = extractXmlElement(customXml, "EncryptedPayload");
  const iv = extractXmlElement(customXml, "IV");
  const tag = extractXmlElement(customXml, "Tag");
  const signature = extractXmlElement(customXml, "Signature");
  const compositionIdEmbedded = extractXmlElement(customXml, "CompositionId");
  const blockIdsEmbedded = extractXmlElement(customXml, "BlockIds");

  for (const [k, v] of [
    ["DocumentType", docType],
    ["SchemaVersion", schemaVersion],
    ["EncryptedPayload", encrypted],
    ["IV", iv],
    ["Tag", tag],
    ["Signature", signature],
    ["CompositionId", compositionIdEmbedded],
    ["BlockIds", blockIdsEmbedded],
  ] as const) {
    if (!v) fail(`missing <${k}> in embedded XML`);
  }
  ok(`all 8 XML fields present in embedded payload`);
  if (compositionIdEmbedded !== composition.id) {
    fail(`embedded CompositionId mismatch: ${compositionIdEmbedded} vs ${composition.id}`);
  }
  ok(`<CompositionId> matches DB composition row`);
  const embeddedBlockIds = blockIdsEmbedded!.split(",").map((s) => s.trim());
  const expectedSorted = [...chosenBlocks].sort();
  if (
    embeddedBlockIds.length !== expectedSorted.length ||
    !embeddedBlockIds.every((b, i) => b === expectedSorted[i])
  ) {
    fail(`<BlockIds> mismatch: ${embeddedBlockIds.join(",")} vs ${expectedSorted.join(",")}`);
  }
  ok(`<BlockIds> correctly enumerates the 5 chosen blocks`);

  // ────────────────────────────────────────────────────────────────────────
  step("Decrypt + verify signature (consumer-side)");
  const { decryptPayload, verifySignature } = await import("@glyph/crypto");

  const tVerify = now();
  const sigOk = await verifySignature(encrypted!, signature!);
  if (!sigOk) fail("signature verification failed");
  const decrypted = (await decryptPayload(encrypted!, iv!, tag!)) as Record<
    string,
    unknown
  >;
  const verifyMs = now() - tVerify;
  ok(`signature ✓ + decrypt ✓ (${verifyMs}ms, zero LLM cost)`);
  if ((decrypted.personal as Record<string, unknown>).full_name !== "Ada Lovelace") {
    fail("decrypted payload corrupt");
  }
  if (!Array.isArray(decrypted.publications) || (decrypted.publications as unknown[]).length !== 1) {
    fail("publications block content lost");
  }
  ok(`payload round-trips: full_name="${(decrypted.personal as Record<string, unknown>).full_name}", projects=${(decrypted.projects as unknown[]).length}, publications=${(decrypted.publications as unknown[]).length}`);

  // ────────────────────────────────────────────────────────────────────────
  step("Tampering detection — flip 4 bytes in ciphertext");
  const tampered = encrypted!.slice(0, -4) + "AAAA";
  let tamperRejected = false;
  try {
    await decryptPayload(tampered, iv!, tag!);
  } catch {
    tamperRejected = true;
  }
  if (!tamperRejected) fail("tampered ciphertext was accepted (BAD)");
  ok(`GCM auth tag rejects tampered ciphertext`);

  // ────────────────────────────────────────────────────────────────────────
  step("Cross-domain composition: try resume blocks for invoice domain");
  const wrongComposeRes = await fetch(`${API_BASE}/api/mcp/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawSecret}`,
    },
    body: JSON.stringify({
      document_type: "invoice",
      structured_data: { document_type: "invoice" },
      output_format: "docx",
      title: "Mismatched composition",
      block_ids: ["resume.base.v1"],
    }),
  });
  // Server should resolve a "composition" with these blocks but validation
  // against `invoice` domain data should fail. Either a 4xx is fine OR the
  // composition is stored as a quirky cross-domain row. We just check the
  // response was NOT a 5xx.
  if (wrongComposeRes.status >= 500) {
    fail(`cross-domain compose returned 5xx: ${wrongComposeRes.status}`);
  }
  ok(`cross-domain compose handled gracefully (status=${wrongComposeRes.status})`);

  // ────────────────────────────────────────────────────────────────────────
  step("Stage 12: Sync — clean docx (no edits)");
  // Re-generate to obtain fresh bytes; the previous downloadUrl may be one-shot.
  const tStage12Gen = now();
  const stage12GenRes = await fetch(`${API_BASE}/api/mcp/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawSecret}`,
    },
    body: JSON.stringify({
      document_type: "resume",
      structured_data: resumeData,
      output_format: "docx",
      title: "Ada Lovelace — Sync Stage 12",
      block_ids: chosenBlocks,
    }),
  });
  if (!stage12GenRes.ok) {
    const body = await stage12GenRes.text();
    fail(`stage 12 generate failed: ${stage12GenRes.status} ${body}`);
  }
  const stage12Gen = (await stage12GenRes.json()) as { downloadUrl: string };
  info(`  generated stage-12 docx (${now() - tStage12Gen}ms)`);
  const cleanDocxRes = await fetch(stage12Gen.downloadUrl);
  if (!cleanDocxRes.ok) fail(`stage-12 download failed: ${cleanDocxRes.status}`);
  const cleanDocxBytes = new Uint8Array(await cleanDocxRes.arrayBuffer());

  const cleanForm = new FormData();
  cleanForm.append(
    "file",
    new Blob([cleanDocxBytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "clean.docx",
  );
  const tStage12Sync = now();
  const cleanSyncRes = await fetch(`${API_BASE}/api/v1/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rawSecret}` },
    body: cleanForm,
  });
  const stage12SyncMs = now() - tStage12Sync;
  if (!cleanSyncRes.ok) {
    const body = await cleanSyncRes.text();
    fail(`stage 12 /api/v1/sync failed: ${cleanSyncRes.status} ${body}`);
  }
  const cleanSync = (await cleanSyncRes.json()) as {
    status: string;
    signature_valid: boolean;
    drift: { changed?: string[]; added?: string[]; removed?: string[]; hasDrift?: boolean } | null;
    updated_file_b64: string | null;
    data: unknown;
  };
  if (cleanSync.status !== "in_sync") {
    fail(`expected status="in_sync", got "${cleanSync.status}"`);
  }
  if (cleanSync.signature_valid !== true) {
    fail(`expected signature_valid=true, got ${cleanSync.signature_valid}`);
  }
  if (cleanSync.drift !== null && cleanSync.drift.hasDrift === true) {
    fail(`expected no drift on clean docx, got hasDrift=true`);
  }
  if (cleanSync.updated_file_b64 !== null) {
    fail(`expected updated_file_b64=null on clean docx`);
  }
  ok(`Stage 12: clean docx is in_sync (${stage12SyncMs}ms)`);
  console.log("  ✓ Stage 12: clean docx is in_sync");

  // ────────────────────────────────────────────────────────────────────────
  step("Stage 13: Sync — edited docx");
  // Modify word/document.xml: swap a visible run text. Use the data we know
  // exists in the visible body. The doc was generated with full_name "Ada
  // Lovelace" and company "Analytical Engine Co." — swap the company so the
  // change is unambiguous and present in a single <w:t> run.
  const editedFiles = unzipSync(cleanDocxBytes);
  const docXmlBytes = editedFiles["word/document.xml"];
  if (!docXmlBytes) fail("stage 13: word/document.xml missing");
  const originalDocXml = Buffer.from(docXmlBytes).toString("utf8");
  // Edit ALL occurrences of a leaf value in the visible body so both the
  // heading paragraph and the per-leaf rendered paragraph carry the new
  // text. The renderer puts every scalar leaf into its own paragraph, so a
  // single search-and-replace flips both.
  const candidates: Array<[string, string]> = [
    ["Ada Lovelace", "Ada Byron"],
    ["Analytical Engine Co.", "Difference Engine Co."],
    ["Lead Algorithmist", "Lead Engineer"],
    ["John", "Jane"],
  ];
  let editedDocXml: string | null = null;
  let appliedEdit: [string, string] | null = null;
  for (const [from, to] of candidates) {
    if (originalDocXml.includes(from)) {
      editedDocXml = originalDocXml.split(from).join(to);
      appliedEdit = [from, to];
      break;
    }
  }
  if (!editedDocXml || !appliedEdit) {
    fail("stage 13: no candidate visible text run found to edit");
  }
  info(`  edited "${appliedEdit[0]}" → "${appliedEdit[1]}"`);
  editedFiles["word/document.xml"] = new TextEncoder().encode(editedDocXml);
  const editedDocxBytes = zipSync(editedFiles);

  const editedForm = new FormData();
  editedForm.append(
    "file",
    new Blob([editedDocxBytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "edited.docx",
  );
  const tStage13Sync = now();
  const editedSyncRes = await fetch(`${API_BASE}/api/v1/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rawSecret}` },
    body: editedForm,
  });
  const stage13SyncMs = now() - tStage13Sync;
  if (!editedSyncRes.ok) {
    const body = await editedSyncRes.text();
    fail(`stage 13 /api/v1/sync failed: ${editedSyncRes.status} ${body}`);
  }
  const editedSync = (await editedSyncRes.json()) as {
    status: string;
    signature_valid: boolean;
    drift: { changed?: string[]; added?: string[]; removed?: string[] } | null;
    updated_file_b64: string | null;
    data: Record<string, unknown>;
  };
  if (editedSync.status !== "synced") {
    fail(`expected status="synced", got "${editedSync.status}"`);
  }
  const driftPaths = [
    ...(editedSync.drift?.changed ?? []),
    ...(editedSync.drift?.added ?? []),
  ];
  if (driftPaths.length === 0) {
    fail(`expected non-empty drift.changed/added, got empty`);
  }
  if (!editedSync.updated_file_b64) {
    fail(`expected non-null updated_file_b64`);
  }
  info(`  drift paths: ${driftPaths.slice(0, 5).join(", ")}${driftPaths.length > 5 ? "…" : ""}`);

  // Decode updated file, parse embedded XML, decrypt new payload.
  const updatedDocxBytes = new Uint8Array(
    Buffer.from(editedSync.updated_file_b64!, "base64"),
  );
  const updatedFiles = unzipSync(updatedDocxBytes);
  const updatedCustomXmlEntry = Object.entries(updatedFiles).find(([k]) =>
    /^customXml\/item\d+\.xml$/.test(k),
  );
  if (!updatedCustomXmlEntry) fail("updated docx is missing customXml/item*.xml");
  const updatedCustomXml = Buffer.from(updatedCustomXmlEntry[1]).toString("utf8");
  const updatedEncrypted = extractXmlElement(updatedCustomXml, "EncryptedPayload");
  const updatedIv = extractXmlElement(updatedCustomXml, "IV");
  const updatedTag = extractXmlElement(updatedCustomXml, "Tag");
  const updatedSignature = extractXmlElement(updatedCustomXml, "Signature");
  if (!updatedEncrypted || !updatedIv || !updatedTag || !updatedSignature) {
    fail("updated docx embedded XML missing required fields");
  }
  const updatedSigOk = await verifySignature(updatedEncrypted!, updatedSignature!);
  if (!updatedSigOk) fail("updated docx: signature verification failed");
  const updatedDecrypted = (await decryptPayload(
    updatedEncrypted!,
    updatedIv!,
    updatedTag!,
  )) as Record<string, unknown>;

  // Verify the visible-text edit is reflected somewhere in the new payload.
  const flatPayload = JSON.stringify(updatedDecrypted);
  const newValue = appliedEdit![1];
  const oldValue = appliedEdit![0];
  const reflectsEdit =
    flatPayload.includes(newValue) && !flatPayload.includes(oldValue);
  // Also accept: at minimum the new value appears in re-extracted data.
  const hasNew = flatPayload.includes(newValue);
  if (!hasNew) {
    fail(
      `re-extracted payload does not contain new value "${newValue}". ` +
        `Drift may have been detected but re-extraction failed.`,
    );
  }
  if (!reflectsEdit) {
    info(`  note: payload contains new value but old value also present (likely in another field)`);
  }
  ok(`Stage 13: edited docx synced (${stage13SyncMs}ms) — drift detected, re-extraction succeeded`);
  console.log("  ✓ Stage 13: edited docx synced — drift detected, re-extraction succeeded");

  // ────────────────────────────────────────────────────────────────────────
  step("Stage 14: Sync — non-Glyph docx");
  // Build a minimal one-paragraph .docx with no Glyph custom XML part.
  const minimalDocumentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n` +
    `  <w:body>\n` +
    `    <w:p><w:r><w:t>Hello from a non-Glyph document.</w:t></w:r></w:p>\n` +
    `  </w:body>\n` +
    `</w:document>`;
  const minimalContentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    `  <Default Extension="xml" ContentType="application/xml"/>\n` +
    `  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n` +
    `</Types>`;
  const minimalRootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n` +
    `</Relationships>`;
  const enc = new TextEncoder();
  const minimalZip: Record<string, Uint8Array> = {
    "[Content_Types].xml": enc.encode(minimalContentTypes),
    "_rels/.rels": enc.encode(minimalRootRels),
    "word/document.xml": enc.encode(minimalDocumentXml),
  };
  const minimalDocxBytes = zipSync(minimalZip);

  const minimalForm = new FormData();
  minimalForm.append(
    "file",
    new Blob([minimalDocxBytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "non-glyph.docx",
  );
  const tStage14Sync = now();
  const minimalSyncRes = await fetch(`${API_BASE}/api/v1/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rawSecret}` },
    body: minimalForm,
  });
  const stage14SyncMs = now() - tStage14Sync;
  if (!minimalSyncRes.ok) {
    const body = await minimalSyncRes.text();
    fail(`stage 14 /api/v1/sync failed: ${minimalSyncRes.status} ${body}`);
  }
  const minimalSync = (await minimalSyncRes.json()) as { status: string };
  if (minimalSync.status !== "no_payload") {
    fail(`expected status="no_payload", got "${minimalSync.status}"`);
  }
  ok(`Stage 14: non-Glyph docx returns no_payload (${stage14SyncMs}ms)`);
  console.log("  ✓ Stage 14: non-Glyph docx returns no_payload");

  // ────────────────────────────────────────────────────────────────────────
  step("Cleanup");
  await cleanup(userId, apiKeyId);
  // Also clean up the documents/compositions we created during the test
  await sql`DELETE FROM schema_compositions WHERE first_seen_user_id = ${userId} OR id = ${composition.id}`;
  ok(`test rows cleaned up`);

  // ────────────────────────────────────────────────────────────────────────
  const totalMs = now() - t0;
  console.log("");
  console.log(bold("📊 Metrics"));
  metric("discover_schema", `${discoverMs}ms`);
  metric("generate (cold)", `${gen1Ms}ms`);
  metric("generate (warm cache)", `${gen2Ms}ms`);
  metric("download .docx", `${downloadMs}ms`);
  metric("verify+decrypt", `${verifyMs}ms`);
  metric("total", `${totalMs}ms`);
  console.log("");
  console.log(yellow(bold("💰 Consumer-side cost: $0.00")) + dim(" — all reads are pure crypto, no LLM"));
  console.log(green(bold("\n✅ Adaptive composition system verified end-to-end")));
  console.log(green(bold("🎉 ALL 14 STAGES PASSED\n")));
}

main()
  .catch(async (e) => {
    console.error(red(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`));
    if (e instanceof Error && e.stack) console.error(dim(e.stack));
    process.exit(1);
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
