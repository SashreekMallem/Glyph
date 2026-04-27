"use client";

import { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Entity = {
  text: string;
  label: string;
  confidence: number;
};

type ChunkResult = {
  heading: string;
  section: string | null;
  entities: Entity[];
  json: unknown;
  status: "pending" | "gliner" | "llm" | "done" | "skipped";
};

// ─── GLiNER labels ────────────────────────────────────────────────────────────

const GLINER_LABELS = [
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

const SCHEMA: Record<string, string> = {
  personal:       `{"full_name":"","email":"","phone":"","linkedin":"","location":"","github":""}`,
  summary:        `{"summary":""}`,
  experience:     `[{"company":"","title":"","start_date":"","end_date":null,"location":"","description":"","achievements":[]}]`,
  education:      `[{"institution":"","degree":"","field":"","graduation_year":null,"gpa":null}]`,
  skills:         `[{"category":"","items":[]}]`,
  certifications: `[{"name":"","issuer":"","date":"","expires":""}]`,
  projects:       `[{"name":"","description":""}]`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunkDocument(text: string) {
  const lines = text.split("\n");
  const chunks: { heading: string; text: string }[] = [];
  let current: { heading: string; lines: string[] } = { heading: "__start__", lines: [] };

  const isHeading = (line: string) => {
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

function classifySection(heading: string, text: string): string | null {
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

function buildPrompt(section: string, spans: Entity[], sectionText: string): string {
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
Section type: ${section}

Section Text:
${sectionText.slice(0, 700)}

GLiNER Hints (pre-detected spans):
${hints}

Target schema:
${SCHEMA[section] ?? "{}"}

Return ONLY the JSON.
<|im_end|>
<|im_start|>assistant
`;
}

function parseJSON(raw: string): unknown {
  try { return JSON.parse(raw.trim()); } catch {}
  const m = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function stripHallucinations(obj: unknown, src: string): unknown {
  const lower = src.toLowerCase();
  if (typeof obj === "string") {
    if (obj.length === 0 || obj.length <= 12) return obj;
    const words = obj.split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return obj;
    const matched = words.filter((w) => lower.includes(w.toLowerCase())).length;
    return matched / words.length >= 0.5 ? obj : "";
  }
  if (Array.isArray(obj)) return obj.map((i) => stripHallucinations(i, src));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = stripHallucinations(v, src);
    return out;
  }
  return obj;
}

function hasContent(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj as Record<string, unknown>).some(
    (v) => (typeof v === "string" && v.length > 0) || (Array.isArray(v) && v.length > 0)
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TestExtractPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Initialising GLiNER worker…");
  const [statusType, setStatusType] = useState<"" | "ok" | "err" | "loading">("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<unknown>(null);
  const [chunks, setChunks] = useState<ChunkResult[]>([]);
  const [running, setRunning] = useState(false);
  const [llmReady, setLlmReady] = useState(false);

  const glinerWorkerRef = useRef<Worker | null>(null);
  const llmWorkerRef    = useRef<Worker | null>(null);

  // ── Boot GLiNER worker ───────────────────────────────────────────────────
  useEffect(() => {
    const w = new Worker(
      new URL("../../../workers/gliner.worker.ts", import.meta.url),
      { type: "module" }
    );
    glinerWorkerRef.current = w;

    w.addEventListener("message", (e) => {
      if (e.data.type === "ready") {
        setStatus("GLiNER ready. Loading LLM worker…");
        setStatusType("loading");
      }
      if (e.data.type === "error") {
        setStatus("GLiNER error: " + e.data.message);
        setStatusType("err");
      }
    });

    w.postMessage({ type: "init" });

    // ── Boot LLM (classifier) worker ────────────────────────────────────────
    const lw = new Worker("/workers/llm.worker.js");
    llmWorkerRef.current = lw;

    lw.addEventListener("message", (e) => {
      if (e.data.type === "ready") {
        setStatus("Both workers ready. Paste a resume and click Extract.");
        setStatusType("ok");
        setLlmReady(true);
        setProgress(100);
      }
      if (e.data.type === "error") {
        setStatus("LLM worker error: " + e.data.message);
        setStatusType("err");
      }
    });

    lw.postMessage({ type: "init" });

    return () => { w.terminate(); lw.terminate(); };
  }, []);

  // ── Run extraction ────────────────────────────────────────────────────────
  const run = async () => {
    if (!text.trim() || !glinerWorkerRef.current || !llmWorkerRef.current) return;
    setRunning(true);
    setResult(null);
    setProgress(0);

    const docChunks = chunkDocument(text);
    const chunkResults: ChunkResult[] = docChunks.map((c) => ({
      heading: c.heading,
      section: classifySection(c.heading, c.text),
      entities: [],
      json: null,
      status: "pending",
    }));
    setChunks([...chunkResults]);

    const finalResult: Record<string, unknown> = { document_type: "resume", schema_version: "1.0" };
    const arrayAccum: Record<string, unknown[]> = {};

    for (let i = 0; i < docChunks.length; i++) {
      const chunk = docChunks[i]!;
      const section = chunkResults[i]!.section;

      if (!section) {
        chunkResults[i]!.status = "skipped";
        setChunks([...chunkResults]);
        continue;
      }

      setProgress(Math.round((i / docChunks.length) * 90));
      setStatus(`GLiNER scanning chunk ${i + 1}/${docChunks.length}: ${chunk.heading}`);
      setStatusType("loading");
      chunkResults[i]!.status = "gliner";
      setChunks([...chunkResults]);

      // ── Stage 1: GLiNER ──────────────────────────────────────────────────
      const entities = await new Promise<Entity[]>((resolve) => {
        const requestId = `${i}-${Date.now()}`;
        const handler = (e: MessageEvent) => {
          if (e.data.type === "result" && e.data.requestId === requestId) {
            glinerWorkerRef.current?.removeEventListener("message", handler);
            resolve((e.data.entities ?? []) as Entity[]);
          }
          if (e.data.type === "error" && e.data.requestId === requestId) {
            glinerWorkerRef.current?.removeEventListener("message", handler);
            resolve([]);
          }
        };
        glinerWorkerRef.current?.addEventListener("message", handler);
        glinerWorkerRef.current?.postMessage({
          type: "extract",
          requestId,
          text: chunk.text,
          entities: GLINER_LABELS,
          threshold: 0.3,
        });
      });

      chunkResults[i]!.entities = entities;
      chunkResults[i]!.status = "llm";
      setChunks([...chunkResults]);

      // ── Stage 2: LLM groups spans ────────────────────────────────────────
      setStatus(`LLM grouping chunk ${i + 1}/${docChunks.length}: ${chunk.heading}`);
      const prompt = buildPrompt(section, entities, chunk.text);

      const llmOut = await new Promise<string>((resolve) => {
        const requestId = `llm-${i}-${Date.now()}`;
        const handler = (e: MessageEvent) => {
          if (e.data.type === "result" && e.data.requestId === requestId) {
            llmWorkerRef.current?.removeEventListener("message", handler);
            resolve(e.data.text ?? "");
          }
          if (e.data.type === "error" && e.data.requestId === requestId) {
            llmWorkerRef.current?.removeEventListener("message", handler);
            resolve("");
          }
        };
        llmWorkerRef.current?.addEventListener("message", handler);
        llmWorkerRef.current?.postMessage({
          type: "generate",
          requestId,
          prompt,
          maxTokens: 500,
        });
      });

      const parsed = parseJSON(llmOut);
      if (parsed) {
        const clean = stripHallucinations(parsed, text);
        if (Array.isArray(clean)) {
          if (!arrayAccum[section]) arrayAccum[section] = [];
          (arrayAccum[section] as unknown[]).push(...(clean as unknown[]).filter(hasContent));
          finalResult[section] = arrayAccum[section];
        } else if (section === "summary") {
          finalResult.summary = (clean as Record<string, unknown>).summary ?? "";
        } else {
          finalResult[section] = { ...(finalResult[section] as object ?? {}), ...(clean as object) };
        }
        chunkResults[i]!.json = clean;
      }

      chunkResults[i]!.status = "done";
      setChunks([...chunkResults]);
      setResult({ ...finalResult });
    }

    setProgress(100);
    setStatus("Extraction complete.");
    setStatusType("ok");
    setResult({ ...finalResult });
    setRunning(false);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const statusColors = {
    "":        "text-neutral-500 border-neutral-800",
    ok:        "text-green-400 border-green-900",
    err:       "text-red-400 border-red-900",
    loading:   "text-yellow-400 border-yellow-900",
  };

  const chunkBorder = {
    pending: "border-neutral-700",
    gliner:  "border-yellow-500",
    llm:     "border-blue-500",
    done:    "border-green-500",
    skipped: "border-neutral-800 opacity-40",
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-8 font-sans">
      <h1 className="text-xl font-semibold mb-1">Glyph — GLiNER + LLM Extraction Test</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Stage 1: GLiNER detects entity spans (verbatim from text). Stage 2: LLM groups spans into schema JSON.
      </p>

      {/* Controls */}
      <div className="flex gap-3 items-center flex-wrap mb-3">
        <button
          onClick={run}
          disabled={running || !llmReady || !text.trim()}
          className="px-5 py-2 rounded-md bg-neutral-100 text-neutral-900 text-sm font-medium disabled:opacity-40"
        >
          {running ? "Extracting…" : "Extract"}
        </button>
        <div className={`text-sm px-3 py-2 rounded-md border bg-neutral-900 flex-1 ${statusColors[statusType]}`}>
          {status}
        </div>
      </div>

      {/* Progress */}
      <div className="h-0.5 bg-neutral-800 rounded mb-6">
        <div className="h-full bg-green-500 rounded transition-all" style={{ width: `${progress}%` }} />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">Paste resume here</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your resume text here..."
            className="w-full h-96 bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-200 text-sm p-3 resize-y font-mono leading-relaxed"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">Structured JSON output</label>
          <pre className="w-full h-96 bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-300 text-xs p-3 overflow-auto whitespace-pre-wrap break-words">
            {result ? JSON.stringify(result, null, 2) : "// Output appears here"}
          </pre>
        </div>
      </div>

      {/* Chunks */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
        <div className="text-xs uppercase tracking-widest text-neutral-600 mb-3">
          Chunks — GLiNER entities shown per chunk
        </div>
        {chunks.length === 0 ? (
          <div className="text-neutral-600 text-sm">Run extraction to see chunks.</div>
        ) : (
          chunks.map((c, i) => (
            <div key={i} className={`mb-3 p-3 bg-neutral-950 rounded-md border-l-2 ${chunkBorder[c.status]}`}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-neutral-300 text-sm">{c.heading}</span>
                <span className="text-xs text-neutral-500">{c.section ?? "skipped"} · {c.status}</span>
              </div>
              {c.entities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.entities.map((e, j) => (
                    <span key={j} className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">
                      {e.text} <span className="text-neutral-500">[{e.label}]</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
