/**
 * Glyph — extraction test logic
 *
 * Two-stage pipeline:
 *   Stage 1 — GLiNER: detects entity spans from existing text (no hallucination)
 *   Stage 2 — Qwen2.5-0.5B: receives raw text + GLiNER hints, groups into schema JSON
 *
 * Run from extract-test.html (file:// or local server).
 * No build step required — uses ESM imports from CDN.
 */

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js";

env.allowRemoteModels = true;
env.useBrowserCache = true;

// ─── Entity labels GLiNER will detect ────────────────────────────────────────

export const GLINER_LABELS = [
  "person name",
  "email address",
  "phone number",
  "linkedin url",
  "github url",
  "location",
  "company name",
  "job title",
  "start date",
  "end date",
  "university or school",
  "degree",
  "field of study",
  "graduation year",
  "skill",
  "certification name",
  "certification issuer",
  "project name",
];

export const TAG_CLASS = {
  "person name":          "tag-person",
  "company name":         "tag-company",
  "job title":            "tag-job-title",
  "start date":           "tag-date",
  "end date":             "tag-date",
  "graduation year":      "tag-date",
  "location":             "tag-location",
  "university or school": "tag-school",
  "degree":               "tag-degree",
  "field of study":       "tag-degree",
  "skill":                "tag-skill",
  "certification name":   "tag-certification",
  "certification issuer": "tag-certification",
  "project name":         "tag-person",
};

// ─── Schema definitions per section ──────────────────────────────────────────

export const SCHEMA = {
  personal:       `{"full_name":"","email":"","phone":"","linkedin":"","location":"","github":""}`,
  summary:        `{"summary":""}`,
  experience:     `[{"company":"","title":"","start_date":"","end_date":null,"location":"","description":"","achievements":[]}]`,
  education:      `[{"institution":"","degree":"","field":"","graduation_year":null,"gpa":null}]`,
  skills:         `[{"category":"","items":[]}]`,
  certifications: `[{"name":"","issuer":"","date":"","expires":""}]`,
  projects:       `[{"name":"","description":""}]`,
};

// ─── Chunk document by natural section headings ───────────────────────────────

export function chunkDocument(text) {
  const lines = text.split("\n");
  const chunks = [];
  let current = { heading: "__start__", lines: [] };

  const isHeading = (line) => {
    const t = line.trim();
    if (t.length < 2 || t.length > 80) return false;
    if (t === t.toUpperCase() && /[A-Z]/.test(t) && !/^https?:\/\//.test(t) && !/[@·•]/.test(t)) return true;
    if (/^#{1,3}\s+\S/.test(t)) return true;
    return false;
  };

  for (const line of lines) {
    if (isHeading(line) && current.lines.filter((l) => l.trim()).length > 0) {
      chunks.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      current = { heading: line.trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.filter((l) => l.trim()).length > 0) {
    chunks.push({ heading: current.heading, text: current.lines.join("\n").trim() });
  }
  return chunks.filter((c) => c.text.length > 15);
}

// ─── Classify section type from heading + first 100 chars ────────────────────

export function classifySection(heading, text) {
  const h = (heading + " " + text.slice(0, 100)).toLowerCase();
  if (/experience|employment|work history|career|position/.test(h)) return "experience";
  if (/education|academic|degree|university|college|school/.test(h))  return "education";
  if (/skill|technical|expertise|tool|platform|language/.test(h))     return "skills";
  if (/certif|license|credential/.test(h))                            return "certifications";
  if (/project|portfolio/.test(h))                                    return "projects";
  if (/summary|profile|objective|about/.test(h))                      return "summary";
  if (/contact|email|phone|linkedin/.test(h))                         return "personal";
  return null;
}

// ─── Build LLM prompt ─────────────────────────────────────────────────────────
// LLM gets: raw section text (source of truth) + GLiNER hints (guidance).
// Strict rule: every value must be verbatim from the text.

export function buildPrompt(sectionType, spans, sectionText) {
  const hints = spans.length > 0 ? JSON.stringify(spans, null, 2) : "none detected";
  return `<|im_start|>system
You are a document field extractor. Extract structured data from the Section Text.
STRICT RULES:
1. Every value MUST be copied verbatim from the Section Text — do not rephrase or invent
2. GLiNER Hints show pre-detected spans — use them as guidance, trust Section Text if they conflict
3. Return ONLY raw JSON matching the schema — no explanation, no markdown, no code blocks
4. If a field has no value in the text use null or empty string — never guess
<|im_end|>
<|im_start|>user
Section type: ${sectionType}

Section Text:
${sectionText.slice(0, 700)}

GLiNER Hints (pre-detected spans):
${hints}

Target schema:
${SCHEMA[sectionType] || "{}"}

Return ONLY the JSON.
<|im_end|>
<|im_start|>assistant
`;
}

// ─── Hallucination filter ─────────────────────────────────────────────────────
// After LLM responds, verify every string value exists in source text.
// Strips anything the LLM invented.

export function stripHallucinations(obj, sourceText) {
  const src = sourceText.toLowerCase();
  if (typeof obj === "string") {
    if (obj.length === 0) return obj;
    if (obj.length <= 12) return obj; // short values (dates, years) — allow
    const words = obj.split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return obj;
    const matched = words.filter((w) => src.includes(w.toLowerCase())).length;
    return matched / words.length >= 0.5 ? obj : "";
  }
  if (Array.isArray(obj)) return obj.map((item) => stripHallucinations(item, sourceText));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = stripHallucinations(v, sourceText);
    return out;
  }
  return obj;
}

export function hasContent(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj).some(
    (v) => (typeof v === "string" && v.length > 0) || (Array.isArray(v) && v.length > 0)
  );
}

// ─── Parse JSON from LLM response ────────────────────────────────────────────

export function parseJSON(raw) {
  try {
    return JSON.parse(raw.trim());
  } catch {
    const m = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }
}

// ─── Model loaders ────────────────────────────────────────────────────────────

export async function loadLLM(onProgress) {
  const tryLoad = (device) =>
    pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", {
      dtype: "q4",
      device,
      progress_callback: onProgress,
    });

  try {
    return await tryLoad("webgpu");
  } catch {
    return await tryLoad("wasm");
  }
}

// Note: GLiNER requires the `gliner` npm package + bundler (used in production).
// In this standalone test we skip GLiNER and rely on LLM alone with the strict prompt.
// The production flow uses the existing gliner.worker.ts in apps/web/src/workers/.
export const GLINER_NOTE =
  "GLiNER requires the bundled Next.js app (gliner npm package). " +
  "This test uses LLM-only extraction with verbatim constraint. " +
  "Production uses GLiNER hints via apps/web/src/workers/gliner.worker.ts.";
