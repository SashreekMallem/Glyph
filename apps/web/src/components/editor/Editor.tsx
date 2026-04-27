"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { editorSchema } from "./schema";
import { editorCommands } from "./commands";
import { autoSavePlugin } from "./plugins/autoSave";
import {
  validationPlugin,
  type ValidationReport,
} from "./plugins/validation";
import {
  glinerExtractorPlugin,
  type GlinerExtractReport,
} from "./plugins/gliner-extractor";
import { descriptorsFor, type DocType } from "./descriptors";
import { typeMapFor } from "./descriptors";
import { docToJson } from "@/lib/editor/serialize";
import { useDocumentDescriptors } from "./hooks/useDocumentDescriptors";

import "./styles.css";

export interface EditorProps {
  readonly documentType: DocType;
  readonly initialJson?: Record<string, unknown>;
  readonly onSave?: (json: Record<string, unknown>) => void;
  readonly onValidation?: (report: ValidationReport) => void;
  readonly onExtract?: (reports: readonly GlinerExtractReport[]) => void;
}

/**
 * Build an empty doc — a single blank paragraph. The user starts with
 * a blank page and writes prose; the extractor plugin promotes matching
 * paragraphs into `field` nodes as the classifier identifies them.
 */
function emptyDoc() {
  return editorSchema.nodes.doc.create(null, [
    editorSchema.nodes.paragraph.create(),
  ]);
}

export function Editor({
  documentType,
  onSave,
  onValidation,
  onExtract,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(
    null,
  ) as RefObject<HTMLDivElement>;
  const viewRef = useRef<EditorView | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [extracted, setExtracted] = useState<GlinerExtractReport[]>([]);

  const fromDb = useDocumentDescriptors(documentType);
  const descriptors = useMemo(
    () =>
      fromDb.descriptors.length > 0
        ? fromDb.descriptors
        : descriptorsFor(documentType),
    [fromDb.descriptors, documentType],
  );
  const typeMap = useMemo(() => typeMapFor(descriptors), [descriptors]);

  const { labelToPath, candidateLabels } = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of descriptors) {
      if (d.path && d.label) m[d.label] = d.path;
    }
    return {
      labelToPath: m,
      candidateLabels: Object.keys(m),
    };
  }, [descriptors]);

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      schema: editorSchema,
      doc: emptyDoc(),
      plugins: [
        ...editorCommands(),
        autoSavePlugin((d) => {
          if (onSave) onSave(docToJson(d, typeMap));
        }),
        validationPlugin(documentType, descriptors, (r) => {
          setReport(r);
          if (onValidation) onValidation(r);
        }),
        glinerExtractorPlugin({
          labelToPath,
          candidateLabels,
          onExtractUpdate: (reports) => {
            setExtracted([...reports]);
            if (onExtract) onExtract(reports);
          },
        }),
      ],
    });

    const view = new EditorView(hostRef.current, { state });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType]);

  return (
    <div className="flex gap-8">
      <div className="flex-1">
        <div ref={hostRef} className="glyph-editor" />
        <p className="mt-4 text-xs text-neutral-400">
          Start typing. The in-browser classifier watches your prose and
          auto-tags each line once it&apos;s confident what it is.
        </p>
      </div>
      <aside className="sticky top-6 h-fit w-64 shrink-0 space-y-5 py-6 text-xs text-neutral-500">
        <div>
          <div className="mb-2 font-sans text-[0.68rem] uppercase tracking-[0.18em] text-neutral-400">
            Validation
          </div>
          {report === null ? (
            <div>Waiting for input…</div>
          ) : report.valid ? (
            <span className="glyph-validation-chip" data-kind="valid">
              ✓ Valid
            </span>
          ) : "drafting" in report && report.drafting ? (
            <div className="text-neutral-400">
              Drafting… keep typing. Fields will appear here as the classifier
              tags them.
            </div>
          ) : "errors" in report ? (
            <div className="space-y-1.5">
              <span className="glyph-validation-chip" data-kind="invalid">
                ✗ {report.errors.length} issue
                {report.errors.length === 1 ? "" : "s"}
              </span>
              <ul className="mt-2 space-y-1">
                {report.errors.slice(0, 6).map((e, i) => (
                  <li key={i} className="leading-tight">
                    <span className="font-mono text-neutral-400">
                      {e.path || "(root)"}
                    </span>
                    <br />
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {extracted.length > 0 && (
          <div>
            <div className="mb-2 font-sans text-[0.68rem] uppercase tracking-[0.18em] text-neutral-400">
              Detected
            </div>
            <ul className="space-y-1.5">
              {[...extracted]
                .sort((a, b) => b.confidence - a.confidence)
                .map((e, i) => (
                  <li key={`${e.from}-${e.label}-${i}`} className="leading-tight">
                    <span className="font-mono text-[0.7rem] text-neutral-900">
                      {e.label}
                    </span>{" "}
                    <span className="text-neutral-400">
                      ({Math.round(e.confidence * 100)}%)
                    </span>
                    <div className="text-[0.7rem] text-neutral-500">
                      “{e.text}”
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
