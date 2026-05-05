"use client";

/**
 * Glyph Tiptap editor — premium minimalist surface.
 *
 * The on-page surface is Tiptap 3.0 over StarterKit + a few extras, plus
 * our custom GlyphFieldMark for the inline field-highlight pattern.
 *
 * The interesting wiring:
 *   1. Tiptap editor.on('update') → debounce 600ms → call onSave(json)
 *      (we serialize Tiptap JSON; the document.sync tRPC mutation lives
 *      in the parent, so this component stays stateless about the API).
 *   2. The existing ProseMirror plugins (extract / decorations / validation)
 *      attach via addProseMirrorPlugins so all our backend integration
 *      survives the engine swap.
 *   3. activeField is a controlled prop — clicking a card in the side
 *      panel sets it; we querySelector the matching span, scrollIntoView,
 *      and add the `glyph-field-pulse` class for 1.2s.
 *
 * No marketing fluff in this file — it's a tool, not a demo.
 */

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

import { GlyphFieldMark } from "./extensions";
import { Toolbar } from "./Toolbar";
import { FieldsPanel, type ExtractedField } from "./FieldsPanel";
import { useDocumentExtraction } from "./hooks/useDocumentExtraction";

export type { ExtractedField } from "./FieldsPanel";

import "./styles.css";

export interface TiptapEditorProps {
  readonly initialHtml?: string;
  readonly readOnly?: boolean;
  readonly placeholder?: string;
  /** Fired with the current Tiptap JSON ~600ms after the user stops typing. */
  readonly onChange?: (json: object, html: string) => void;
  /** Fired immediately on every keystroke for hot loops (extraction stream). */
  readonly onTransact?: (editor: Editor) => void;
  /** Fields to render in the right rail. Ignored when `extraction` is set. */
  readonly fields?: readonly ExtractedField[];
  /** Override the side-panel rail (use null to hide). */
  readonly sidePanel?: React.ReactNode | null;
  /**
   * When set, the editor runs streaming Gemini extraction internally on
   * the editor's plain text and surfaces the resulting fields in the
   * side panel. Each emitted field value is also auto-marked in the
   * document with the GlyphFieldMark, so the side-panel jump-to works.
   */
  readonly extraction?: {
    readonly docId: string;
    readonly schemaType: string;
  };
}

const SAVE_DEBOUNCE_MS = 600;

export function TiptapEditor({
  initialHtml,
  readOnly = false,
  placeholder = "Write a resume, contract, invoice — Glyph reads as you go.",
  onChange,
  onTransact,
  fields: externalFields = [],
  sidePanel,
  extraction,
}: TiptapEditorProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editorText, setEditorText] = useState<string>("");

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: "text-emerald-600 underline underline-offset-2",
            rel: "noopener noreferrer",
          },
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass:
            "before:content-[attr(data-placeholder)] before:float-left before:text-neutral-400 before:italic before:pointer-events-none before:h-0",
        }),
        CharacterCount,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        GlyphFieldMark,
      ],
      content: initialHtml ?? "",
      editable: !readOnly,
      editorProps: {
        attributes: {
          class:
            "glyph-editor prose prose-neutral dark:prose-invert max-w-none focus:outline-none",
        },
      },
      onUpdate: ({ editor: ed }) => {
        // Track plain text for the extraction pipeline. Done synchronously
        // (cheap) so the streaming hook never lags the UI.
        setEditorText(ed.getText());
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          const json = ed.getJSON();
          const html = ed.getHTML();
          setLastSaved(new Date());
          onChange?.(json, html);
        }, SAVE_DEBOUNCE_MS);
      },
      onTransaction: ({ editor: ed }) => {
        onTransact?.(ed);
      },
      // Avoid hydration mismatch between SSR and client.
      immediatelyRender: false,
    },
    [readOnly],
  );

  // Cleanup save timer on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Streaming Gemini extraction → flat field list.
  const liveExtraction = useDocumentExtraction({
    docId: extraction?.docId ?? "",
    schemaType: extraction?.schemaType ?? "",
    text: editorText,
    enabled: !!extraction && !readOnly,
  });

  const fields = extraction ? liveExtraction.fields : externalFields;

  // Apply GlyphFieldMark for every value we just extracted. We do a
  // string match on the live editor text to find the span — good enough
  // until we plumb per-leaf source regions all the way through.
  useEffect(() => {
    if (!editor || !extraction) return;
    if (fields.length === 0) return;
    applyFieldMarks(editor, fields);
    // Only re-apply when fields actually change, not on every transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, editor, extraction]);

  const editorRoot = surfaceRef.current;

  // Default side panel — only shown when the caller didn't override.
  const renderedSidePanel = useMemo(() => {
    if (sidePanel === null) return null;
    if (sidePanel !== undefined) return sidePanel;
    return (
      <FieldsPanel
        fields={fields}
        editorRoot={editorRoot}
      />
    );
  }, [sidePanel, fields, editorRoot]);

  return (
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="sticky top-2 z-10 mb-4">
          <Toolbar editor={editor} lastSaved={lastSaved} />
        </div>
        <div
          ref={surfaceRef}
          className="rounded-2xl border border-neutral-200 bg-white px-8 py-10 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-neutral-800 dark:bg-neutral-900 sm:px-12"
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      {renderedSidePanel !== null && (
        <aside className="lg:sticky lg:top-2 lg:h-fit">{renderedSidePanel}</aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// applyFieldMarks — find each extracted leaf value in the editor text and
// wrap it with the GlyphFieldMark mark so the side panel's jump-to lands.
// String-match is fragile but acceptable until per-leaf source regions
// flow through the pipeline (see _meta.regions on the backend).
// ---------------------------------------------------------------------------

function applyFieldMarks(editor: Editor, fields: readonly ExtractedField[]) {
  const doc = editor.state.doc;
  const tr = editor.state.tr;
  let touched = false;

  for (const field of fields) {
    if (field.value === null || field.value === undefined) continue;
    const needle = String(field.value).trim();
    if (needle.length < 2) continue;

    // Walk text nodes and find the FIRST occurrence of the needle.
    let foundFrom = -1;
    let foundTo = -1;
    doc.descendants((node, pos) => {
      if (foundFrom !== -1) return false;
      if (!node.isText || !node.text) return true;
      const idx = node.text.indexOf(needle);
      if (idx >= 0) {
        foundFrom = pos + idx;
        foundTo = foundFrom + needle.length;
      }
      return true;
    });
    if (foundFrom < 0) continue;

    const markType = editor.schema.marks.glyphField;
    if (!markType) continue;

    // Skip if this exact range already carries the same path.
    const existing = doc
      .resolve(foundFrom)
      .marks()
      .find((m) => m.type === markType && m.attrs.path === field.path);
    if (existing) continue;

    tr.addMark(
      foundFrom,
      foundTo,
      markType.create({
        path: field.path,
        verified: field.verified ?? null,
      }),
    );
    touched = true;
  }

  if (touched) {
    // setMeta('addToHistory', false) keeps these auto-marks out of undo so
    // the user's Cmd-Z doesn't strip extracted highlights.
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }
}
