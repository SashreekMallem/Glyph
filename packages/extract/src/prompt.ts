// Append-only prompt builder for Gemini 3 Flash Lite.
//
// The prompt is split into a byte-stable PREFIX (cacheable via Gemini's
// cachedContent API) and a variable SUFFIX. Only the suffix grows turn by
// turn; the prefix is content-addressed via sha256 so callers can pass a
// stable cache key.
//
// Framing matches buildCacheBreakpoints in prefix-cache.ts so prefix bytes
// and breakpoint hashes line up across both helpers.

import { createHash } from "node:crypto";
import { stableStringify } from "./prefix-cache.js";
import type { ExtractRequest } from "./types.js";

/**
 * `buildPrompt` only needs the prompt-relevant fields of `ExtractRequest`.
 * Picking from the canonical type keeps the two in lockstep.
 */
export type BuildPromptInput = Pick<
  ExtractRequest,
  | "schemaJson"
  | "schemaVersion"
  | "currentEase"
  | "textDelta"
  | "fullText"
  | "sessionId"
  | "examples"
> & {
  /**
   * Targeted re-extraction: when present, the model is instructed to emit
   * ops ONLY for these dot-notation paths (e.g. `["personal.email"]`).
   * Lives in the SUFFIX so the cacheable prefix stays byte-stable.
   */
  readonly onlyPaths?: readonly string[];
};

export interface BuiltPrompt {
  /** Byte-stable cacheable content. */
  prefix: string;
  /** Variable per-turn content (state + delta). */
  suffix: string;
  /** SHA-256 hex of the prefix. */
  cacheKey: string;
}

const FULL_TEXT_TAIL_LIMIT = 8000;

const SYSTEM_PROMPT = [
  "You are a real-time document extraction model.",
  "You receive a JSON Schema, a current EASE-encoded state, and a chunk of newly observed text (the delta).",
  "Your job: emit RFC 6902 JSON Patch operations that update the EASE state to reflect any new facts found in the delta.",
  "",
  "Output contract (STRICT — your output is fed directly to JSON.parse):",
  "- Return ONLY a single JSON array of RFC 6902 operation objects. No markdown fences, no prose, no comments, no trailing text.",
  "- Each op MUST have exactly the keys it needs:",
  "    add     -> { \"op\": \"add\",     \"path\": \"...\", \"value\": <any JSON> }",
  "    replace -> { \"op\": \"replace\", \"path\": \"...\", \"value\": <any JSON> }",
  "    remove  -> { \"op\": \"remove\",  \"path\": \"...\" }",
  "    test    -> { \"op\": \"test\",    \"path\": \"...\", \"value\": <any JSON> }",
  "    move    -> { \"op\": \"move\",    \"path\": \"...\", \"from\": \"...\" }",
  "    copy    -> { \"op\": \"copy\",    \"path\": \"...\", \"from\": \"...\" }",
  "- `value` is a real JSON value of ANY type (object, array, string, number, boolean, null). NEVER stringify it.",
  "",
  "Semantic rules:",
  "1. NEVER re-emit a field that already exists in the current state with the same value. Only emit patches for new or changed information.",
  "2. To set a scalar or object property, use `add` if absent, or `replace` if present.",
  "3. ARRAY-typed properties from the JSON Schema have TWO possible representations in state:",
  "   (a) A plain JSON array, e.g. `[ {...}, {...} ]`. This is the canonical form when the array does not yet exist or is being created from scratch.",
  "   (b) An EASE-encoded object, e.g. `{ \"__ease__\": true, \"display_order\": [\"item_0001\", ...], \"item_0001\": {...} }`. The runtime may convert (a) into this form for addressability.",
  "4. RULE OF THUMB for arrays:",
  "   - If the array does NOT yet exist in state: emit a single `add` with the full plain JSON array as the value (e.g. `{ \"op\": \"add\", \"path\": \"/experience\", \"value\": [ {...}, {...} ] }`). Do NOT wrap it as `__ease__`.",
  "   - If state already shows the array as a plain array: use `replace` on the whole array, or `add` at `/path/-` to append.",
  "   - If state already shows the array as an EASE object (`__ease__: true`): append with `add` at `/path/-` (the runtime mints `item_NNNN`); edit existing elements by `add`/`replace` at `/path/item_NNNN/...`; remove with `{op:\"remove\", path:\"/path/item_NNNN\"}`.",
  "5. NEVER emit an `__ease__` literal yourself. The runtime owns that representation.",
  "6. Object-typed properties (e.g. `personal`) are plain JSON objects. Add or replace them whole when first populating; `add`/`replace` individual sub-keys for incremental edits.",
  "7. JSON Pointer paths must be RFC 6901-escaped (`~0` for `~`, `~1` for `/`).",
  "8. If the delta contains no new schema-relevant facts, output an empty array `[]`.",
  "9. Never invent facts. If the delta does not assert a value, do not emit it.",
  "10. Date fields use ISO `YYYY-MM-DD`. If only a year is known, use `YYYY-01-01`. If end_date is \"Present\" / ongoing, omit `end_date`.",
  "",
  "PER-LEAF SOURCE SPANS (REQUIRED for self-healing sync):",
  "- Every op MUST carry `srcStart` and `srcEnd` — 0-indexed character offsets into the delta where the value was found. Half-open: srcEnd is exclusive.",
  "- Emit ONE op per LEAF value, never bulk-add nested objects/arrays. Do NOT emit `{op:\"add\", path:\"/personal\", value:{full_name:\"John\", email:\"john@x.com\"}}` — split into:",
  "    {op:\"add\", path:\"/personal/full_name\", value:\"John\", srcStart:N, srcEnd:M}",
  "    {op:\"add\", path:\"/personal/email\", value:\"john@x.com\", srcStart:N, srcEnd:M}",
  "- For ARRAYS: first emit `{op:\"add\", path:\"/experience\", value:[]}` (no srcStart/srcEnd needed for empty container creation), then for each element emit one op per leaf using `/experience/0/field`, `/experience/1/field`, etc.",
  "- The span MUST cover the exact substring the leaf value was extracted from. Do not include surrounding labels (\"Email:\") unless they are part of the value itself.",
  "- If a leaf value is synthesised (e.g. a normalised date `2020-01-01` from the text \"2020\"), span the source text the synthesis was based on (\"2020\").",
].join("\n");

const EASE_PRIMER = [
  "EASE encoding (Explicitly Addressed Sequence Encoding) — runtime addressability for arrays:",
  "- Once the runtime addresses an array, it is shaped:",
  '    { "__ease__": true, "display_order": ["item_0001","item_0002"], "item_0001": {...}, "item_0002": {...} }',
  "- `display_order` is the canonical render order; element keys are stable `item_NNNN` ids (4-digit zero-padded).",
  "- When you SEE an EASE container in state: append with `/path/-` (the runtime mints the next `item_NNNN`); edit by `item_NNNN` key (e.g. `/line_items/item_0003/qty`); remove by key.",
  "- When you do NOT see an EASE container (the array is missing or is a plain array): emit the value as a plain JSON array. Never emit `__ease__` or `display_order` yourself.",
].join("\n");

const DEFAULT_EXAMPLES: unknown[] = [
  {
    note: "Empty state: ONE op per LEAF with srcStart/srcEnd. Containers ({} or []) are created first without spans, then each leaf is set individually.",
    delta:
      "John Smith\nProduct Manager\njohn@x.com\n\nExperience\n- Acme — PM (2020-Present)",
    // 0         11               29        39
    state: {},
    patches: [
      { op: "add", path: "/document_type", value: "resume" },
      { op: "add", path: "/personal", value: {} },
      { op: "add", path: "/personal/full_name", value: "John Smith", srcStart: 0, srcEnd: 10 },
      { op: "add", path: "/personal/email", value: "john@x.com", srcStart: 29, srcEnd: 39 },
      { op: "add", path: "/experience", value: [] },
      { op: "add", path: "/experience/0", value: {} },
      { op: "add", path: "/experience/0/company", value: "Acme", srcStart: 53, srcEnd: 57 },
      { op: "add", path: "/experience/0/title", value: "PM", srcStart: 60, srcEnd: 62 },
      { op: "add", path: "/experience/0/start_date", value: "2020-01-01", srcStart: 64, srcEnd: 68 },
    ],
  },
  {
    note: "Append a new role when state already has an EASE-encoded experience array.",
    delta: "- Initech — Director of Product (2022-Present): grew revenue 4x.",
    state: {
      personal: { full_name: "John Smith", email: "john@x.com" },
      experience: {
        __ease__: true,
        display_order: ["item_0001"],
        item_0001: {
          company: "Acme",
          title: "PM",
          start_date: "2020-01-01",
          description: "launched a new SKU",
        },
      },
    },
    patches: [
      {
        op: "add",
        path: "/experience/-",
        value: {
          company: "Initech",
          title: "Director of Product",
          start_date: "2022-01-01",
          description: "grew revenue 4x",
        },
      },
    ],
  },
  {
    note: "Replace a scalar that already has a (different) value.",
    delta: "Updated email: john.smith@new.com",
    state: {
      personal: { full_name: "John Smith", email: "john@x.com" },
    },
    patches: [
      {
        op: "replace",
        path: "/personal/email",
        value: "john.smith@new.com",
      },
    ],
  },
  {
    note: "Nothing schema-relevant in the delta.",
    delta: "References available upon request.",
    state: { personal: { full_name: "John Smith", email: "john@x.com" } },
    patches: [],
  },
];

function buildPrefix(
  schemaJson: unknown,
  schemaVersion: string,
  examples: unknown[],
): string {
  // schema_version is embedded inside the <schema> block in a stable position.
  const schemaBlock = stableStringify({
    schema: schemaJson,
    schema_version: schemaVersion,
  });
  const systemBlock = SYSTEM_PROMPT + "\n\n" + EASE_PRIMER;
  const examplesBlock = stableStringify(examples);

  return (
    "<system>\n" +
    systemBlock +
    "\n</system>\n" +
    "<schema>\n" +
    schemaBlock +
    "\n</schema>\n" +
    "<examples>\n" +
    examplesBlock +
    "\n</examples>"
  );
}

function tailTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

function buildSuffix(
  currentEase: unknown,
  textDelta: string,
  fullText: string | undefined,
  sessionId: string,
  onlyPaths: readonly string[] | undefined,
): string {
  const parts: string[] = [];
  parts.push("<session>" + sessionId + "</session>");
  parts.push("<state>\n" + stableStringify(currentEase) + "\n</state>");
  // Use fullText as the extraction target when available — textDelta alone is
  // too small for Gemini to extract from on the first pass or after a reload.
  const extractionContent =
    fullText !== undefined && fullText.length > 0 ? fullText : textDelta;
  parts.push(
    "<<DELTA>>" +
      tailTruncate(extractionContent, FULL_TEXT_TAIL_LIMIT) +
      "<<END_DELTA>>",
  );
  if (onlyPaths !== undefined && onlyPaths.length > 0) {
    parts.push(
      "<focus_paths>\n" +
        onlyPaths.join("\n") +
        "\n</focus_paths>\n" +
        "When <focus_paths> is present: emit ops ONLY for these dot-notation paths (translate dots to RFC 6901 slashes). Skip every other field. If a focus path is no longer asserted by the source text, emit `{op:\"remove\", path:\"/that/path\"}`. Always include srcStart/srcEnd on add/replace ops.",
    );
  }
  parts.push("Emit RFC 6902 patches as a JSON array. No prose.");
  return parts.join("\n");
}

/**
 * Build a Gemini prompt split into a byte-stable, cacheable prefix and a
 * variable per-turn suffix. The returned `cacheKey` is sha256(prefix).
 *
 * Pure: identical inputs produce identical outputs. No I/O.
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const examples =
    input.examples !== undefined ? input.examples : DEFAULT_EXAMPLES;
  const prefix = buildPrefix(input.schemaJson, input.schemaVersion, examples);
  const suffix = buildSuffix(
    input.currentEase,
    input.textDelta,
    input.fullText,
    input.sessionId,
    input.onlyPaths,
  );
  const cacheKey = createHash("sha256").update(prefix, "utf8").digest("hex");
  return { prefix, suffix, cacheKey };
}
