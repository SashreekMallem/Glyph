/**
 * Gap detector — finds fields that GLiNER2's current schema doesn't cover
 * but the document text clearly mentions, and proposes them.
 *
 * Runs after GLiNER2 extraction. Given:
 *   - the original text
 *   - the spans GLiNER2 returned (with start/end offsets)
 *   - the active JSON Schema (from loader)
 *
 * Compute uncovered regions = stretches of text > 80 chars that aren't
 * inside any returned span. If a region looks structured (has a heading
 * or labeled bullets), ask Gemini whether it's a new field/section worth
 * adding to the schema.
 *
 * Outcomes:
 *   • Gemini confidence >= 0.8 → auto-add to schema_blocks
 *     (proposed_by_user_id = caller, is_curated=false)
 *   • Lower confidence → schema_block_proposals (human review queue)
 *
 * Both paths use `onConflictDoNothing` so duplicate proposals are silently
 * deduped; we surface usage_count instead of repeated rows.
 *
 * This is deliberately conservative — false positives pollute the schema
 * library forever. We only propose when both:
 *   (a) the uncovered region has structural signals (heading | bullets |
 *       key:value patterns)
 *   (b) Gemini returns a proposal with explicit field_name + description
 */

import { GoogleGenAI } from "@google/genai";

import { schemaBlockProposals, schemaBlocks } from "@/db/schema";
import { getExtractEnv } from "@/lib/extract/env";

import type { LoaderDB } from "./loader";

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface ExtractedSpan {
  readonly path: string;
  readonly value: unknown;
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

export interface DetectGapsArgs {
  readonly typeKey: string;
  readonly text: string;
  readonly spans: readonly ExtractedSpan[];
  readonly jsonSchema: Record<string, unknown>;
  readonly userId?: string;
}

export interface GapProposal {
  readonly fieldName: string;
  readonly fieldType: "string" | "number" | "integer" | "boolean" | "array" | "object";
  readonly description: string;
  readonly confidence: number;
  readonly sourceRegion: { start: number; end: number };
}

export interface DetectGapsResult {
  readonly proposals: readonly GapProposal[];
  readonly autoAdded: readonly GapProposal[];
  readonly queued: readonly GapProposal[];
}

// ---------------------------------------------------------------------------
// Uncovered region extraction
// ---------------------------------------------------------------------------

const MIN_REGION_CHARS = 80;
const MAX_REGIONS = 5;
const AUTO_ADD_THRESHOLD = 0.8;
const GEMINI_TIMEOUT_MS = 12_000;

interface Region {
  start: number;
  end: number;
  text: string;
}

export function uncoveredRegions(
  text: string,
  spans: readonly ExtractedSpan[],
): Region[] {
  if (text.length === 0) return [];

  // Sort + merge spans.
  const sorted = [...spans]
    .filter((s) => s.start < s.end && s.start >= 0 && s.end <= text.length)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ start: s.start, end: s.end });
    }
  }

  // Walk gaps between merged spans.
  const regions: Region[] = [];
  let cursor = 0;
  for (const m of merged) {
    if (m.start - cursor >= MIN_REGION_CHARS) {
      regions.push({
        start: cursor,
        end: m.start,
        text: text.slice(cursor, m.start).trim(),
      });
    }
    cursor = m.end;
  }
  if (text.length - cursor >= MIN_REGION_CHARS) {
    regions.push({
      start: cursor,
      end: text.length,
      text: text.slice(cursor).trim(),
    });
  }

  return regions.filter((r) => r.text.length >= MIN_REGION_CHARS);
}

// ---------------------------------------------------------------------------
// Heuristic — does a region look structured?
// ---------------------------------------------------------------------------

const HEADING_RE = /^[A-Z][A-Za-z ]{2,40}:?\s*$/m;
const BULLET_RE = /(^|\n)[\s]*[-•*]\s+/;
const KV_RE = /(^|\n)\s*[A-Z][A-Za-z _-]{1,30}:\s*\S/;

export function looksStructured(text: string): boolean {
  return HEADING_RE.test(text) || BULLET_RE.test(text) || KV_RE.test(text);
}

// ---------------------------------------------------------------------------
// Existing schema introspection (to avoid proposing dupes)
// ---------------------------------------------------------------------------

export function collectExistingFieldNames(schema: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const obj = node as Record<string, unknown>;
    const props = obj.properties;
    if (typeof props === "object" && props !== null) {
      for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
        names.add(k);
        visit(v);
      }
    }
    const items = obj.items;
    if (typeof items === "object" && items !== null) visit(items);
  };
  visit(schema);
  return names;
}

// ---------------------------------------------------------------------------
// Gemini proposer
// ---------------------------------------------------------------------------

const PROPOSER_PROMPT = `You are analyzing a region of a user's document that the current extraction
schema did NOT capture. Your task: decide whether this region represents a
new field/section that should be added to the schema.

Document type: {{TYPE_KEY}}
Existing fields (do NOT propose duplicates): {{EXISTING_FIELDS}}

Region text:
"""
{{REGION_TEXT}}
"""

RESPOND with ONE of these JSON shapes, no prose, no markdown:

If this is a meaningful new field worth adding:
{
  "should_propose": true,
  "field_name": "snake_case_name",
  "field_type": "string" | "number" | "integer" | "boolean" | "array" | "object",
  "description": "one-sentence description of what this field captures",
  "confidence": 0.0 to 1.0
}

If this is noise / boilerplate / a duplicate / not worth adding:
{
  "should_propose": false,
  "reason": "brief reason"
}

GUIDELINES:
- Only propose if the region has clear structure (heading, label, repeated pattern).
- DO NOT propose if it's prose like a summary, a footer, or generic text.
- DO NOT propose if a similar field already exists (see EXISTING_FIELDS).
- confidence >= 0.8 means "I am highly certain this is a real new field type."
- Lower confidence = "maybe, but a human should review."`;

interface ProposerResponse {
  should_propose: boolean;
  field_name?: string;
  field_type?: GapProposal["fieldType"];
  description?: string;
  confidence?: number;
  reason?: string;
}

async function proposeFieldForRegion(
  typeKey: string,
  region: Region,
  existingFields: Set<string>,
): Promise<GapProposal | null> {
  const env = getExtractEnv();
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

  const existingList = [...existingFields].sort().slice(0, 50).join(", ");

  const prompt = PROPOSER_PROMPT.replace("{{TYPE_KEY}}", typeKey)
    .replace("{{EXISTING_FIELDS}}", existingList || "(none yet)")
    .replace("{{REGION_TEXT}}", region.text.slice(0, 1500));

  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), GEMINI_TIMEOUT_MS);

  try {
    const result = await ai.models.generateContent({
      model: env.geminiModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const raw = result.text;
    if (typeof raw !== "string" || raw.length === 0) return null;

    let parsed: ProposerResponse;
    try {
      parsed = JSON.parse(raw) as ProposerResponse;
    } catch {
      return null;
    }

    if (!parsed.should_propose) return null;
    if (
      typeof parsed.field_name !== "string" ||
      typeof parsed.field_type !== "string" ||
      typeof parsed.description !== "string" ||
      typeof parsed.confidence !== "number"
    ) {
      return null;
    }
    if (existingFields.has(parsed.field_name)) return null;

    const VALID_TYPES = new Set([
      "string",
      "number",
      "integer",
      "boolean",
      "array",
      "object",
    ]);
    if (!VALID_TYPES.has(parsed.field_type)) return null;

    return {
      fieldName: parsed.field_name,
      fieldType: parsed.field_type,
      description: parsed.description,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      sourceRegion: { start: region.start, end: region.end },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function autoAddBlock(
  db: LoaderDB,
  typeKey: string,
  proposal: GapProposal,
  userId?: string,
): Promise<void> {
  const blockId = `${typeKey}.${proposal.fieldName}.auto-${Date.now()}`;
  const blockSchema = {
    type: "object",
    properties: {
      [proposal.fieldName]: {
        type: proposal.fieldType,
        description: proposal.description,
      },
    },
  };

  try {
    await db
      .insert(schemaBlocks)
      .values({
        id: blockId,
        domain: typeKey,
        name: proposal.fieldName,
        version: "auto-1.0",
        jsonSchema: blockSchema,
        isCurated: false,
        isRequiredForDomain: false,
        dependsOn: [],
        proposedByUserId: userId,
      })
      .onConflictDoNothing();
  } catch {
    // best-effort
  }
}

async function queueProposal(
  db: LoaderDB,
  typeKey: string,
  proposal: GapProposal,
  userId?: string,
): Promise<void> {
  const proposedSchema = {
    type: "object",
    properties: {
      [proposal.fieldName]: {
        type: proposal.fieldType,
        description: proposal.description,
      },
    },
    required: [],
  };

  try {
    await db
      .insert(schemaBlockProposals)
      .values({
        domain: typeKey,
        proposedName: proposal.fieldName,
        proposedJsonSchema: proposedSchema,
        rationale: `Auto-detected from extraction gap (confidence ${proposal.confidence.toFixed(2)})`,
        proposedByUserId: userId,
        status: "pending",
      })
      .onConflictDoNothing();
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function detectGaps(
  db: LoaderDB,
  args: DetectGapsArgs,
): Promise<DetectGapsResult> {
  const { typeKey, text, spans, jsonSchema, userId } = args;

  const regions = uncoveredRegions(text, spans)
    .filter((r) => looksStructured(r.text))
    .slice(0, MAX_REGIONS);

  if (regions.length === 0) {
    return { proposals: [], autoAdded: [], queued: [] };
  }

  const existing = collectExistingFieldNames(jsonSchema);

  const proposals = (
    await Promise.all(
      regions.map((r) => proposeFieldForRegion(typeKey, r, existing)),
    )
  ).filter((p): p is GapProposal => p !== null);

  // Dedupe within this batch — Gemini might propose the same name twice.
  const seenNames = new Set<string>();
  const unique = proposals.filter((p) => {
    if (seenNames.has(p.fieldName)) return false;
    seenNames.add(p.fieldName);
    return true;
  });

  const autoAdded: GapProposal[] = [];
  const queued: GapProposal[] = [];

  for (const p of unique) {
    if (p.confidence >= AUTO_ADD_THRESHOLD) {
      await autoAddBlock(db, typeKey, p, userId);
      autoAdded.push(p);
    } else {
      await queueProposal(db, typeKey, p, userId);
      queued.push(p);
    }
  }

  return { proposals: unique, autoAdded, queued };
}
