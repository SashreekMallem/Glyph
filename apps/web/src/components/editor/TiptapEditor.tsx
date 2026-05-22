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
import { BubbleMenu as BubbleMenuWrapper, FloatingMenu as FloatingMenuWrapper } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details } from "@tiptap/extension-details";
import { DetailsContent } from "@tiptap/extension-details-content";
import { DetailsSummary } from "@tiptap/extension-details-summary";
import { Image } from "@tiptap/extension-image";
import { Youtube } from "@tiptap/extension-youtube";
import { TableOfContents } from "@tiptap/extension-table-of-contents";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { Markdown } from "@tiptap/markdown";
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
import { ReactRenderer } from "@tiptap/react";
import tippy from "tippy.js";
import { common, createLowlight } from "lowlight";

import type { StyleProfile } from "@glyph/style-profile";

import { GlyphFieldMark } from "./extensions";
import { Toolbar } from "./Toolbar";
import { FieldsPanel, type ExtractedField } from "./FieldsPanel";
import { profileToStyleObject } from "./style-vars";
import { useDocumentExtraction } from "./hooks/useDocumentExtraction";
import { BubbleMenu } from "./menus/BubbleMenu";
import { FloatingMenu } from "./menus/FloatingMenu";
import { SlashCommand } from "./menus/SlashCommand";
import { CommandList, getSuggestionItems } from "./menus/CommandList";
import {
  CorrectionPopover,
  type CorrectionDocType,
} from "./CorrectionPopover";

// Create lowlight instance for syntax highlighting
const lowlight = createLowlight(common);

export type { ExtractedField } from "./FieldsPanel";

import "./styles.css";

export interface TiptapEditorProps {
  /** Tiptap JSON doc to hydrate on mount. Takes priority over initialHtml. */
  readonly initialContent?: object;
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
   * Called whenever the extraction pipeline produces a new decoded JSON
   * object. Use this to persist the extracted structured data separately
   * from the editor document state.
   */
  readonly onExtracted?: (json: Record<string, unknown>) => void;
  /**
   * When set, the editor runs streaming Gemini extraction internally on
   * the editor's plain text and surfaces the resulting fields in the
   * side panel.
   */
  readonly extraction?: {
    readonly docId: string;
    readonly schemaType: string;
    readonly initialJson?: unknown;
    readonly encrypted?: string;
    readonly iv?: string;
    readonly tag?: string;
    readonly signature?: string;
  };
  /**
   * Optional visual style profile (fonts/colors/sizes/margins). Surfaces
   * as CSS custom properties on the editor's outermost wrapper so the
   * rules in `styles.css` pick up author-specified styling. When omitted,
   * the CSS variables fall back to their hardcoded defaults which match
   * the `GLYPH_MODERN_PROFILE` values — so behavior is unchanged for
   * documents that don't ship a profile yet.
   */
  readonly styleProfile?: StyleProfile;
  /**
   * Document id, used by the toolbar's brand-profile switcher to call
   * `documents.setStyleProfile`. When omitted the switcher is hidden —
   * the editor still works without it, just no inline profile swap.
   */
  readonly documentId?: string;
}

const SAVE_DEBOUNCE_MS = 600;

export function TiptapEditor({
  initialContent,
  initialHtml,
  readOnly = false,
  placeholder = "Write a resume, contract, invoice — Glyph reads as you go.",
  onChange,
  onTransact,
  onExtracted,
  fields: externalFields = [],
  sidePanel,
  extraction,
  styleProfile,
  documentId,
}: TiptapEditorProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editorText, setEditorText] = useState<string>("");
  const [correction, setCorrection] = useState<{
    anchorEl: HTMLElement;
    path: string;
    value: string;
    label: string;
    confidence: number;
    region: [number, number] | null;
  } | null>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          // Disabled here — we register Link below with custom HTMLAttributes.
          link: false,
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
        Subscript,
        Superscript,
        TextAlign.configure({
          types: ["heading", "paragraph"],
        }),
        Highlight.configure({ multicolor: true }),
        Typography,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        CodeBlockLowlight.configure({
          lowlight,
        }),
        Details,
        DetailsContent,
        DetailsSummary,
        Image.configure({
          inline: true,
          allowBase64: true,
        }),
        Youtube.configure({
          width: 640,
          height: 360,
        }),
        TableOfContents,
        TextStyle,
        Color,
        FontFamily,
        Markdown,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        SlashCommand.configure({
          suggestion: {
            items: getSuggestionItems,
            render: () => {
              let component: any;
              let popup: any;

              return {
                onStart: (props: any) => {
                  component = new ReactRenderer(CommandList, {
                    props,
                    editor: props.editor,
                  });

                  popup = tippy("body", {
                    getReferenceClientRect: props.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true,
                    interactive: true,
                    trigger: "manual",
                    placement: "bottom-start",
                  });
                },
                onUpdate(props: any) {
                  component.updateProps(props);
                  popup[0].setProps({
                    getReferenceClientRect: props.clientRect,
                  });
                },
                onKeyDown(props: any) {
                  if (props.event.key === "Escape") {
                    popup[0].hide();
                    return true;
                  }
                  return component.ref?.onKeyDown(props);
                },
                onExit() {
                  popup[0].destroy();
                  component.destroy();
                },
              };
            },
          },
        }),
        GlyphFieldMark,
      ],
      // initialContent (Tiptap JSON) takes priority over initialHtml string.
      content: initialContent ?? initialHtml ?? "",
      editable: !readOnly,
      editorProps: {
        attributes: {
          class:
            "glyph-editor prose prose-neutral dark:prose-invert max-w-none focus:outline-none",
          spellcheck: "false",
          "data-gramm": "false",
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

  // Open the correction popover when the user clicks a low-confidence span.
  // We listen on the editor DOM (not document) so the listener tears down
  // with the editor view, and we read the mark's metadata straight from the
  // span's data-* attributes — no need to resolve ProseMirror positions for
  // a passive read.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const onClick = (ev: MouseEvent) => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const span = target.closest<HTMLElement>(
        'span[data-glyph-uncertain="true"]',
      );
      if (!span) return;
      ev.preventDefault();
      ev.stopPropagation();
      const path = span.getAttribute("data-glyph-field") ?? "";
      const confRaw = span.getAttribute("data-glyph-confidence");
      const conf = confRaw === null ? 0 : Number.parseFloat(confRaw);
      const regionRaw = span.getAttribute("data-region");
      let region: [number, number] | null = null;
      if (regionRaw) {
        const [aRaw, bRaw] = regionRaw.split(",");
        const a = aRaw !== undefined ? Number.parseInt(aRaw, 10) : NaN;
        const b = bRaw !== undefined ? Number.parseInt(bRaw, 10) : NaN;
        if (Number.isFinite(a) && Number.isFinite(b)) {
          region = [a, b];
        }
      }
      setCorrection({
        anchorEl: span,
        path,
        value: span.textContent ?? "",
        // Last path segment is a reasonable human label fallback until the
        // pipeline starts emitting an explicit `label` attr.
        label: path.split(".").pop() ?? path,
        confidence: Number.isFinite(conf) ? conf : 0,
        region,
      });
    };
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
    };
  }, [editor]);

  // Listen for custom export events from the Page header
  useEffect(() => {
    const handlePdf = () => console.log("Exporting PDF...");
    const handleDocx = () => {
      const html = editor?.getHTML() ?? "";
      const meta = extraction ? `
<!-- GLYPH-METADATA
{
  "encrypted": "${extraction.encrypted || ""}",
  "iv": "${extraction.iv || ""}",
  "tag": "${extraction.tag || ""}",
  "signature": "${extraction.signature || ""}",
  "document_type": "${extraction.schemaType || ""}"
}
-->` : "";
      const content = `<html><head><meta charset="UTF-8"></head><body>${meta}${html}</body></html>`;
      const blob = new Blob([content], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "document.doc";
      a.click();
      URL.revokeObjectURL(url);
    };
    const handleMd = () => {
      const markdown = (editor?.storage as any).markdown?.getMarkdown() ?? "";
      const frontmatter = extraction ? `---
glyph_id: "${extraction.docId}"
glyph_type: "${extraction.schemaType}"
glyph_encrypted: "${extraction.encrypted || ""}"
glyph_iv: "${extraction.iv || ""}"
glyph_tag: "${extraction.tag || ""}"
glyph_signature: "${extraction.signature || ""}"
---

` : "";
      const blob = new Blob([frontmatter + markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "document.md";
      a.click();
      URL.revokeObjectURL(url);
    };
    const handleTxt = () => {
      const text = editor?.getText() ?? "";
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "document.txt";
      a.click();
      URL.revokeObjectURL(url);
    };

    document.addEventListener("glyph-export-pdf", handlePdf);
    document.addEventListener("glyph-export-docx", handleDocx);
    document.addEventListener("glyph-export-md", handleMd);
    document.addEventListener("glyph-export-txt", handleTxt);
    
    return () => {
      document.removeEventListener("glyph-export-pdf", handlePdf);
      document.removeEventListener("glyph-export-docx", handleDocx);
      document.removeEventListener("glyph-export-md", handleMd);
      document.removeEventListener("glyph-export-txt", handleTxt);
    };
  }, [editor]);

  // Fallback: If live extraction is empty (e.g. for finalized docs), 
  // harvest fields directly from the document marks.
  const harvestedFields = useMemo(() => {
    if (!editor) return [];
    const found = new Map<string, ExtractedField>();
    
    // Visit every node in the document to find marks.
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.length > 0) {
        node.marks.forEach((mark) => {
          if (mark.type.name === "glyphField" && mark.attrs.path) {
            const path = mark.attrs.path;
            const text = node.text || "";
            
            if (found.has(path)) {
              // Append text if multiple nodes share the same path (e.g. bolded parts)
              const existing = found.get(path)!;
              found.set(path, {
                ...existing,
                value: String(existing.value) + text,
              });
            } else {
              found.set(path, {
                path,
                value: text,
              });
            }
          }
        });
      }
      return true;
    });
    
    return Array.from(found.values());
  }, [editor, editor?.state.doc]);

  // Streaming Gemini extraction → flat field list + source-region map.
  const liveExtraction = useDocumentExtraction({
    docId: extraction?.docId ?? "",
    schemaType: extraction?.schemaType ?? "",
    text: editorText,
    enabled: !!extraction && !readOnly,
    initialJson: extraction?.initialJson,
  });

  const fields = useMemo(() => {
    const base = extraction ? liveExtraction.fields : externalFields;
    if (base && base.length > 0) return base;
    return harvestedFields;
  }, [extraction, liveExtraction.fields, externalFields, harvestedFields]);

  const liveRegions = liveExtraction.regions;

  // Notify parent whenever extraction produces new structured JSON.
  // Debounced to avoid hammering the documents.save API on every stream patch.
  const onExtractedRef = useRef(onExtracted);
  onExtractedRef.current = onExtracted;
  useEffect(() => {
    if (!extraction || !liveExtraction.json) return;
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(() => {
      onExtractedRef.current?.(liveExtraction.json as Record<string, unknown>);
    }, SAVE_DEBOUNCE_MS);
  }, [liveExtraction.json, extraction]);

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

  // Compose the inline `style` map for the editor wrapper. When a
  // styleProfile is supplied we emit its CSS variables here so the rules
  // in `styles.css` (font-family / color / etc.) pick up the override
  // without us having to inline every property by hand. Falls back to
  // `undefined` so React skips writing an empty `style` attribute.
  const profileStyle = useMemo(
    () => (styleProfile ? profileToStyleObject(styleProfile) : undefined),
    [styleProfile],
  );

  return (
    <div
      className="grid w-full gap-8 lg:grid-cols-[minmax(0,1fr)_360px]"
      style={profileStyle}
    >
      <div className="min-w-0">
        <div className="sticky top-[80px] z-10 mb-6">
          <Toolbar
            editor={editor}
            lastSaved={lastSaved}
            styleProfile={
              documentId
                ? {
                    docId: documentId,
                    // Best-effort current-profile name. When the doc carries no
                    // custom profile we display the built-in default name so the
                    // user has visual confirmation of what's applied.
                    currentProfileName:
                      styleProfile?.name ?? "Glyph Modern",
                  }
                : undefined
            }
          />
        </div>
        <div
          ref={surfaceRef}
          className="rounded-3xl border border-neutral-200 bg-white px-10 py-12 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:border-neutral-800 dark:bg-neutral-900 sm:px-16"
        >
          {editor && <BubbleMenu editor={editor} />}
          {editor && <FloatingMenu editor={editor} />}
          <EditorContent editor={editor} className="glyph-editor-surface" />
          {editor && correction ? (
            <CorrectionPopover
              open={true}
              anchorEl={correction.anchorEl}
              path={correction.path}
              currentValue={correction.value}
              currentLabel={correction.label}
              confidence={correction.confidence}
              docId={extraction?.docId}
              docType={asCorrectionDocType(extraction?.schemaType)}
              region={correction.region}
              sourceText={editorText}
              onClose={() => setCorrection(null)}
              onAccept={(newValue, newLabel) => {
                // The user edited the value/label — update the mark in place
                // so the side panel and downstream consumers see the fix.
                // We rewrite the text only if the value changed; the label
                // is encoded in the `path` attribute today, so we keep the
                // path stable but bump confidence to 1 to clear the dotted
                // underline.
                if (!correction) return;
                const { from, to } = findSpanRange(
                  editor,
                  correction.anchorEl,
                );
                if (from < 0 || to < 0) return;
                const markType = editor.schema.marks.glyphField;
                if (!markType) return;
                const tr = editor.state.tr;
                if (newValue !== correction.value) {
                  tr.insertText(newValue, from, to);
                }
                const newTo = from + newValue.length;
                tr.addMark(
                  from,
                  newTo,
                  markType.create({
                    path: correction.path,
                    region: correction.region,
                    confidence: 1,
                    verified: true,
                  }),
                );
                tr.setMeta("addToHistory", true);
                editor.view.dispatch(tr);
                // Touch newLabel so the linter doesn't flag the unused arg;
                // when the schema grows a `label` attr we'll persist it here.
                void newLabel;
              }}
              onReject={() => {
                if (!correction) return;
                const { from, to } = findSpanRange(
                  editor,
                  correction.anchorEl,
                );
                if (from < 0 || to < 0) return;
                editor
                  .chain()
                  .focus()
                  .setTextSelection({ from, to })
                  .unsetGlyphField()
                  .run();
              }}
            />
          ) : null}
        </div>
      </div>
      {renderedSidePanel !== null && (
        <aside className="relative">
          <div className="sticky top-[80px] h-[calc(100vh-120px)] overflow-y-auto pr-2 scrollbar-hide">
            {renderedSidePanel}
          </div>
        </aside>
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

// Normalize the editor's free-form `schemaType` to the typed enum the
// correction popover expects. Anything off-list collapses to "resume".
function asCorrectionDocType(raw: string | undefined): CorrectionDocType {
  if (raw === "contract" || raw === "invoice" || raw === "resume") return raw;
  return "resume";
}

// Find the ProseMirror range that backs a given rendered span. We walk every
// text-bearing position checking whether the editor's coordsAtPos lands
// inside the element's bounding box — cheaper than tracking node→DOM maps
// and robust to inline marks splitting a span across multiple text nodes.
function findSpanRange(
  editor: Editor,
  span: HTMLElement,
): { from: number; to: number } {
  const view = editor.view;
  const rect = span.getBoundingClientRect();
  // domAtPos walks each text node; we look for the node whose DOM is a
  // descendant of `span`.
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    try {
      const dom = view.domAtPos(pos);
      const domNode: Node = dom.node;
      const target: Element | null =
        domNode instanceof Text
          ? domNode.parentElement
          : domNode instanceof Element
            ? domNode
            : null;
      if (target && span.contains(target)) {
        if (from < 0) from = pos;
        to = pos + (node.text?.length ?? 0);
      }
    } catch {
      // domAtPos can throw for transient positions during dispatch.
    }
    return true;
  });
  // Fallback: derive from cursor position at the rect's center if walk failed.
  if (from < 0) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const at = view.posAtCoords({ left: cx, top: cy });
    if (at) {
      from = at.pos;
      to = at.pos + (span.textContent?.length ?? 0);
    }
  }
  return { from, to };
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
