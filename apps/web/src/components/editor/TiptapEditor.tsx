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
  /** Fields to render in the right rail. */
  readonly fields?: readonly ExtractedField[];
  /** Override the side-panel rail (use null to hide). */
  readonly sidePanel?: React.ReactNode | null;
}

const SAVE_DEBOUNCE_MS = 600;

export function TiptapEditor({
  initialHtml,
  readOnly = false,
  placeholder = "Write a resume, contract, invoice — Glyph reads as you go.",
  onChange,
  onTransact,
  fields = [],
  sidePanel,
}: TiptapEditorProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

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
