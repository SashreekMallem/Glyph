"use client";

import { FloatingMenu as TiptapFloatingMenu } from "@tiptap/react/menus";
import { Heading1, Heading2, List, ListOrdered, Table, Plus } from "lucide-react";
import React from "react";

/**
 * FloatingMenu — empty-line block insertion menu.
 */
export function FloatingMenu({ editor }: { editor: any }) {
  if (!editor) return null;

  return (
    <TiptapFloatingMenu
      editor={editor}
      tippyOptions={{ duration: 100 }}
      className="floating-menu"
    >
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={editor.isActive("heading", { level: 1 }) ? "is-active" : ""}
        title="Heading 1"
      >
        <Heading1 size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={editor.isActive("heading", { level: 2 }) ? "is-active" : ""}
        title="Heading 2"
      >
        <Heading2 size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive("bulletList") ? "is-active" : ""}
        title="Bullet List"
      >
        <List size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive("orderedList") ? "is-active" : ""}
        title="Numbered List"
      >
        <ListOrdered size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        title="Insert Table"
      >
        <Table size={18} />
      </button>
    </TiptapFloatingMenu>
  );
}
