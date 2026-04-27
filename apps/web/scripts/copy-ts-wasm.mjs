#!/usr/bin/env node
// Copy tree-sitter WASM artefacts from node_modules into apps/web/public/
// so the browser can fetch them at `/tree-sitter/tree-sitter.wasm` and
// `/tree-sitter/tree-sitter-markdown.wasm`.
//
// Run:
//   node apps/web/scripts/copy-ts-wasm.mjs
//
// Exits 0 on success, 0 with a warning when a source WASM is missing
// (useful in CI where `tree-sitter-markdown` may be absent), non-zero on
// unexpected I/O failure.

import { mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");
const DEST_DIR = resolve(WEB_ROOT, "public", "tree-sitter");

/**
 * Resolve a file from either the local package's node_modules or the
 * workspace hoist. pnpm hoists to the repo root; we check web-local first.
 */
async function resolveAsset(relative) {
  const candidates = [
    resolve(WEB_ROOT, "node_modules", relative),
    resolve(REPO_ROOT, "node_modules", relative),
  ];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

const ASSETS = [
  {
    source: "web-tree-sitter/tree-sitter.wasm",
    dest: "tree-sitter.wasm",
    required: true,
  },
  {
    // tree-sitter-markdown publishes `tree-sitter-markdown.wasm` at its
    // package root in recent versions. If the package is not present,
    // warn but do not fail — the worker will return an error message
    // when it tries to load the missing grammar at runtime.
    source: "tree-sitter-markdown/tree-sitter-markdown.wasm",
    dest: "tree-sitter-markdown.wasm",
    required: false,
  },
];

async function main() {
  await mkdir(DEST_DIR, { recursive: true });

  let copied = 0;
  for (const asset of ASSETS) {
    const src = await resolveAsset(asset.source);
    if (!src) {
      const message = `[copy-ts-wasm] source not found: ${asset.source}`;
      if (asset.required) {
        console.error(message);
        process.exitCode = 1;
      } else {
        console.warn(`${message} (optional)`);
      }
      continue;
    }
    const dest = resolve(DEST_DIR, asset.dest);
    await copyFile(src, dest);
    copied += 1;
    console.log(`[copy-ts-wasm] ${asset.source} -> public/tree-sitter/${asset.dest}`);
  }

  console.log(`[copy-ts-wasm] copied ${copied} file(s) to ${DEST_DIR}`);
}

main().catch((err) => {
  console.error("[copy-ts-wasm] fatal:", err);
  process.exit(1);
});
