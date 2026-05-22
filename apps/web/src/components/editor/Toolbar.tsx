"use client";

/**
 * Tiptap toolbar — minimalist, inline icons, no external deps.
 *
 * Subscribes to the editor's `selectionUpdate` and `transaction` events so
 * active states (bold, current heading level, etc.) stay in sync.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";

import { StyleSwitcher } from "./StyleSwitcher";

export interface ToolbarProps {
  editor: Editor | null;
  lastSaved?: Date | null;
  /**
   * Optional brand-profile switcher context. Rendered next to the
   * Font/Color controls when both `docId` and the profile-name fields
   * are available. The TiptapEditor wires this up from the loaded
   * document DTO; we keep it optional here so the toolbar still works
   * in test harnesses that don't touch the document API.
   */
  styleProfile?: {
    docId: string;
    currentProfileName: string;
    currentProfileId?: string;
  };
}

export function Toolbar({ editor, lastSaved, styleProfile }: ToolbarProps) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => force((n) => n + 1);
    editor.on("selectionUpdate", onUpdate);
    editor.on("transaction", onUpdate);
    return () => {
      editor.off("selectionUpdate", onUpdate);
      editor.off("transaction", onUpdate);
    };
  }, [editor]);

  if (!editor) return null;

  const block = currentBlockKey(editor);

  return (
    <div className="flex items-center gap-1 rounded-xl border border-neutral-200 bg-white/85 px-2 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/85">
      <BlockSelect editor={editor} value={block} />
      <Sep />
      <IconBtn
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 5h6a4 4 0 0 1 0 8H7zM7 13h7a4 4 0 0 1 0 8H7z" />
        </svg>
      </IconBtn>
      <IconBtn
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 4h-9M14 20H5M15 4l-6 16" />
        </svg>
      </IconBtn>
      <IconBtn
        label="Strike"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h18M16 6c-1.2-1.5-3-2-5-2-3.5 0-5 2-5 4 0 2 1 3 4 4M8 18c1.2 1.5 3 2 5 2 3.5 0 5-2 5-4 0-1-.4-1.8-1-2.5" />
        </svg>
      </IconBtn>
      <IconBtn
        label="Code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
        </svg>
      </IconBtn>
      <Sep />
      <IconBtn
        label="Bulleted list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="6" r="1.2" /><circle cx="5" cy="12" r="1.2" /><circle cx="5" cy="18" r="1.2" />
          <path d="M10 6h11M10 12h11M10 18h11" />
        </svg>
      </IconBtn>
      <IconBtn
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 6h11M10 12h11M10 18h11M3 4v4M3 8h2M3 14h2.5L3 17h2.5" />
        </svg>
      </IconBtn>
      <IconBtn
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 7h4v4c0 2.5-1.5 4-4 4M14 7h4v4c0 2.5-1.5 4-4 4" />
        </svg>
      </IconBtn>
      <Sep />
      <IconBtn
        label="Insert link"
        active={editor.isActive("link")}
        onClick={() => {
          const url = window.prompt("URL");
          if (!url) return;
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
        </svg>
      </IconBtn>
      <IconBtn
        label="Insert table"
        active={false}
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 16h18M9 4v16M15 4v16" />
        </svg>
      </IconBtn>
      <Sep />
      <IconBtn label="Undo" active={false} onClick={() => editor.chain().focus().undo().run()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h12a5 5 0 0 1 0 10h-4M3 7l4-4M3 7l4 4" />
        </svg>
      </IconBtn>
      <IconBtn label="Redo" active={false} onClick={() => editor.chain().focus().redo().run()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7H9a5 5 0 0 0 0 10h4M21 7l-4-4M21 7l-4 4" />
        </svg>
      </IconBtn>
      <Sep />
      <FontSelect editor={editor} />
      <ColorSelect editor={editor} />
      {styleProfile && (
        <>
          <Sep />
          <StyleSwitcher
            docId={styleProfile.docId}
            currentProfileName={styleProfile.currentProfileName}
            currentProfileId={styleProfile.currentProfileId}
          />
        </>
      )}

      <span className="ml-auto flex items-center gap-3 pl-2 pr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-400">
        <CharCount editor={editor} />
        <SaveIndicator at={lastSaved ?? null} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Sep() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />;
}

const BLOCK_OPTIONS = [
  { key: "p", label: "Body" },
  { key: "h1", label: "Title" },
  { key: "h2", label: "Heading" },
  { key: "h3", label: "Subhead" },
] as const;

type BlockKey = (typeof BLOCK_OPTIONS)[number]["key"];

function currentBlockKey(editor: Editor): BlockKey {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  return "p";
}

function BlockSelect({ editor, value }: { editor: Editor; value: BlockKey }) {
  const active = BLOCK_OPTIONS.find((o) => o.key === value) ?? BLOCK_OPTIONS[0]!;
  return (
    <div className="relative">
      <select
        aria-label="Block style"
        value={value}
        onChange={(e) => {
          const v = e.target.value as BlockKey;
          if (v === "p") editor.chain().focus().setParagraph().run();
          else if (v === "h1") editor.chain().focus().toggleHeading({ level: 1 }).run();
          else if (v === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
          else if (v === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
        }}
        className="cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-2 pr-6 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        {BLOCK_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-neutral-400"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
      <span className="sr-only">Current: {active.label}</span>
    </div>
  );
}

function IconBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
        active
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

function CharCount({ editor }: { editor: Editor }) {
  const storage = editor.storage as { characterCount?: { characters: () => number } };
  const n = storage.characterCount?.characters?.() ?? 0;
  return <span>{n.toLocaleString()} ch</span>;
}

function FontSelect({ editor }: { editor: Editor }) {
  const fonts = [
    { label: "Serif", value: "ui-serif" },
    { label: "Sans", value: "ui-sans-serif" },
    { label: "Mono", value: "ui-monospace" },
  ];
  return (
    <div className="relative">
      <select
        aria-label="Font family"
        onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
        className="cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-2 pr-6 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-700 hover:bg-neutral-100 focus:outline-none dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        <option value="">Font</option>
        {fonts.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ColorSelect({ editor }: { editor: Editor }) {
  const colors = [
    { label: "Emerald", value: "#10b981" },
    { label: "Indigo", value: "#6366f1" },
    { label: "Rose", value: "#f43f5e" },
    { label: "Amber", value: "#f59e0b" },
    { label: "Gray", value: "#71717a" },
  ];
  return (
    <div className="relative">
      <select
        aria-label="Text color"
        onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        className="cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-2 pr-6 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-700 hover:bg-neutral-100 focus:outline-none dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        <option value="">Color</option>
        {colors.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SaveIndicator({ at }: { at: Date | null }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  if (!at) return <span className="text-neutral-300">Unsaved</span>;
  const ago = Math.max(0, Math.round((now - at.getTime()) / 1000));
  return (
    <span className="text-emerald-600">
      ✓ Saved {ago < 5 ? "just now" : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`}
    </span>
  );
}
