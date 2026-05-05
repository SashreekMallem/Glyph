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

  // Streaming Gemini extraction → flat field list + source-region map.
  const liveExtraction = useDocumentExtraction({
    docId: extraction?.docId ?? "",
    schemaType: extraction?.schemaType ?? "",
    text: editorText,
    enabled: !!extraction && !readOnly,
  });

  const fields = extraction ? liveExtraction.fields : externalFields;
  const liveRegions = liveExtraction.regions;

  // Apply GlyphFieldMark for every value we just extracted. When the
  // model emitted source regions for a path, we use those byte offsets
  // (mapped to ProseMirror doc positions). Otherwise we fall back to a
  // plain-text indexOf — fragile for synthesized values like "five years"
  // → "5 years" but correct for proper-noun-style leaves.
  useEffect(() => {
    if (!editor || !extraction) return;
    if (fields.length === 0) return;
    applyFieldMarks(editor, fields, liveRegions);
    // Only re-apply when fields actually change, not on every transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, liveRegions, editor, extraction]);

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
// applyFieldMarks — wrap each extracted leaf value in the editor with the
// GlyphFieldMark so the side panel's jump-to lands on the right span.
//
// Two sourcing paths, in priority order:
//
//   1. Source regions (preferred). The model emitted `srcStart`/`srcEnd`
//      byte offsets into the editor's plain text. We translate those to
//      ProseMirror doc positions via a single linear walk that mirrors
//      the editor's `getText()` semantics (text-node content concatenated
//      with `\n` between block boundaries).
//
//   2. Plain-text indexOf fallback. When no region is available, search
//      the editor text for the first occurrence of the value. Fragile for
//      synthesized values (e.g. "5 years" rendered for "five years") but
//      correct for proper-noun leaves.
// ---------------------------------------------------------------------------

function applyFieldMarks(
  editor: Editor,
  fields: readonly ExtractedField[],
  regions: Record<string, [number, number]>,
) {
  const doc = editor.state.doc;
  const tr = editor.state.tr;
  const markType = editor.schema.marks.glyphField;
  if (!markType) return;
  let touched = false;

  // Build a plain-text-offset → doc-position map ONCE per call.
  const offsetIndex = buildPlainTextIndex(doc);

  for (const field of fields) {
    if (field.value === null || field.value === undefined) continue;
    const region = regions[field.path];

    let foundFrom = -1;
    let foundTo = -1;

    if (region) {
      const [start, end] = region;
      const fromPos = offsetIndex.toDocPos(start);
      const toPos = offsetIndex.toDocPos(end);
      if (fromPos !== null && toPos !== null && toPos > fromPos) {
        foundFrom = fromPos;
        foundTo = toPos;
      }
    }

    if (foundFrom < 0) {
      const needle = String(field.value).trim();
      if (needle.length < 2) continue;
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
    }

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
        region: region ?? null,
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

/**
 * Build an offset→position lookup for the current doc. We walk every
 * text node accumulating its length into a plain-text counter, plus a
 * `\n` between block-level node boundaries to match `editor.getText()`.
 *
 * Returns a `toDocPos(offset)` function that maps a plain-text offset
 * back to the ProseMirror doc position the model meant.
 */
interface OffsetIndex {
  toDocPos: (textOffset: number) => number | null;
}

function buildPlainTextIndex(doc: import("@tiptap/pm/model").Node): OffsetIndex {
  // Each entry: { textStart, textEnd, docStart } — a contiguous text run.
  // Block boundaries between runs cost 1 plain-text char (the "\n").
  interface Run {
    readonly textStart: number;
    readonly textEnd: number;
    readonly docStart: number;
  }
  const runs: Run[] = [];
  let textCursor = 0;
  let prevWasText = false;

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const len = node.text.length;
      runs.push({
        textStart: textCursor,
        textEnd: textCursor + len,
        docStart: pos,
      });
      textCursor += len;
      prevWasText = true;
      return false;
    }
    if (node.isBlock && prevWasText) {
      // The model received "\n" between blocks (mirrors getText()).
      textCursor += 1;
      prevWasText = false;
    }
    return true;
  });

  return {
    toDocPos(textOffset: number): number | null {
      // Find the run that contains this text offset.
      for (const r of runs) {
        if (textOffset >= r.textStart && textOffset <= r.textEnd) {
          return r.docStart + (textOffset - r.textStart);
        }
      }
      return null;
    },
  };
}
