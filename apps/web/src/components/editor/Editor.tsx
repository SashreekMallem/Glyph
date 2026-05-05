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
import { extractPlugin } from "./plugins/extract";
import { extractDecorationsPlugin } from "./plugins/decorations";
import { descriptorsFor, type DocType } from "./descriptors";
import { typeMapFor } from "./descriptors";
import { docToJson } from "@/lib/editor/serialize";
import { useDocumentDescriptors } from "./hooks/useDocumentDescriptors";
import { ExtractedFieldsPanel } from "./ExtractedFieldsPanel";

import "./styles.css";

export interface EditorProps {
  readonly documentType: DocType;
  readonly docId?: string;
  readonly schemaVersion?: string;
  readonly initialJson?: Record<string, unknown>;
  readonly onSave?: (json: Record<string, unknown>) => void;
  readonly onValidation?: (report: ValidationReport) => void;
  readonly onExtract?: (ease: Record<string, unknown>) => void;
  readonly onExtractError?: (message: string) => void;
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
  docId,
  schemaVersion,
  onSave,
  onValidation,
  onExtract,
  onExtractError,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(
    null,
  ) as RefObject<HTMLDivElement>;
  const viewRef = useRef<EditorView | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [extracted, setExtracted] = useState<Record<string, unknown> | null>(
    null,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const streamingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (streamingTimerRef.current) clearTimeout(streamingTimerRef.current);
    };
  }, []);

  const fromDb = useDocumentDescriptors(documentType);
  const descriptors = useMemo(
    () =>
      fromDb.descriptors.length > 0
        ? fromDb.descriptors
        : descriptorsFor(documentType),
    [fromDb.descriptors, documentType],
  );
  const typeMap = useMemo(() => typeMapFor(descriptors), [descriptors]);

  useEffect(() => {
    if (!hostRef.current) return;

    const plugins = [
      ...editorCommands(),
      autoSavePlugin((d) => {
        if (onSave) onSave(docToJson(d, typeMap));
      }),
      validationPlugin(documentType, descriptors, (r) => {
        setReport(r);
        if (onValidation) onValidation(r);
      }),
    ];

    if (docId) {
      // Schema is resolved server-side; the plugin runs without a local
      // zod validator and skips client-side patch validation.
      const extractPluginInstance = extractPlugin({
        docId,
        schemaType: documentType,
        schemaJson: undefined,
        schemaVersion: schemaVersion ?? "v1",
        onStateChange: (ease) => {
          const next = ease as Record<string, unknown>;
          setExtracted(next);
          setIsStreaming(true);
          if (streamingTimerRef.current) {
            clearTimeout(streamingTimerRef.current);
          }
          streamingTimerRef.current = setTimeout(() => {
            setIsStreaming(false);
          }, 500);
          if (onExtract) onExtract(next);
        },
        onError: (err) => {
          if (onExtractError) onExtractError(err.message);
        },
      });
      plugins.push(extractPluginInstance);
      plugins.push(
        extractDecorationsPlugin({
          getEase: (s) => {
            const pluginState = extractPluginInstance.getState(s) as
              | { ease?: Record<string, unknown> }
              | undefined;
            return pluginState?.ease ?? null;
          },
        }),
      );
    }

    const state = EditorState.create({
      schema: editorSchema,
      doc: emptyDoc(),
      plugins,
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
    <div className="flex gap-6">
      {/* Editor surface */}
      <div className="flex-1 min-w-0">
        <div ref={hostRef} className="glyph-editor" />
      </div>

      {/* Extracted fields panel */}
      <aside className="sticky top-6 h-fit w-72 shrink-0 space-y-4 py-2">
        {/* Validation strip */}
        {report !== null && (
          <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            {report.valid ? (
              <span className="glyph-validation-chip" data-kind="valid">✓ Valid</span>
            ) : "drafting" in report && report.drafting ? (
              <p className="text-[0.68rem] text-neutral-400">Drafting…</p>
            ) : "errors" in report ? (
              <div className="space-y-1">
                <span className="glyph-validation-chip" data-kind="invalid">
                  ✗ {report.errors.length} issue{report.errors.length === 1 ? "" : "s"}
                </span>
                <ul className="mt-1.5 space-y-1 text-[0.68rem]">
                  {report.errors.slice(0, 4).map((e, i) => (
                    <li key={i} className="leading-tight text-neutral-600">
                      <span className="font-mono text-neutral-400">{e.path || "(root)"}</span>
                      {" "}{e.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {/* Extracted fields */}
        <ExtractedFieldsPanel
          ease={extracted}
          isStreaming={isStreaming}
          activeField={activeField}
          onFieldHover={setActiveField}
        />
      </aside>
    </div>
  );
}
