"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Table,
  Quote,
  Minus,
  Youtube,
  Image as ImageIcon,
  Columns,
  Layout,
  TableOfContents,
  Smile,
  Hash,
  Search,
  Eraser,
  Download,
  Info,
  Layers,
  FileText,
  Code2,
} from "lucide-react";

/**
 * Helper to download a string as a file
 */
const downloadFile = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * CommandList — the UI for the Slash Command menu.
 */
export const CommandList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      props.command(item);
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex(
          (selectedIndex + props.items.length - 1) % props.items.length
        );
        return true;
      }

      if (event.key === "ArrowDown") {
        setSelectedIndex((selectedIndex + 1) % props.items.length);
        return true;
      }

      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
  }));

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  const groupedItems = props.items.reduce((acc: any, item: any) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="z-50 max-h-[420px] min-w-[240px] overflow-y-auto overflow-x-hidden rounded-xl border border-neutral-200 bg-white/95 p-1 shadow-2xl backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 scrollbar-hide">
      {props.items.length > 0 ? (
        Object.entries(groupedItems).map(([group, items]: [string, any]) => (
          <div key={group}>
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              {group}
            </div>
            {items.map((item: any) => {
              const index = props.items.indexOf(item);
              return (
                <button
                  key={index}
                  onClick={() => selectItem(index)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-all ${
                    index === selectedIndex
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border ${
                      index === selectedIndex
                        ? "border-emerald-200 bg-white shadow-sm dark:border-emerald-800 dark:bg-neutral-900"
                        : "border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800"
                    }`}
                  >
                    {item.icon}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate font-semibold">{item.title}</span>
                    <span className="truncate text-[10px] opacity-60">
                      {item.subtitle}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ))
      ) : (
        <div className="px-3 py-2 text-sm text-neutral-400">No results found</div>
      )}
    </div>
  );
});

CommandList.displayName = "CommandList";

export const getSuggestionItems = ({ query }: { query: string }) => {
  const items = [
    // --- BASIC ---
    {
      group: "Basic Blocks",
      title: "Text",
      subtitle: "Plain text paragraph.",
      icon: <Type size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setNode("paragraph").run();
      },
    },
    {
      group: "Basic Blocks",
      title: "Heading 1",
      subtitle: "Main section title.",
      icon: <Heading1 size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
      },
    },
    {
      group: "Basic Blocks",
      title: "Heading 2",
      subtitle: "Subsection title.",
      icon: <Heading2 size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
      },
    },
    {
      group: "Basic Blocks",
      title: "Bullet List",
      subtitle: "Simple unordered list.",
      icon: <List size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      group: "Basic Blocks",
      title: "Numbered List",
      subtitle: "Simple ordered list.",
      icon: <ListOrdered size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      group: "Basic Blocks",
      title: "Task List",
      subtitle: "Track tasks with checkboxes.",
      icon: <CheckSquare size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    {
      group: "Basic Blocks",
      title: "Quote",
      subtitle: "Emphasized blockquote.",
      icon: <Quote size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      group: "Basic Blocks",
      title: "Divider",
      subtitle: "Horizontal separator line.",
      icon: <Minus size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run();
      },
    },

    // --- MEDIA ---
    {
      group: "Media & Embeds",
      title: "Image",
      subtitle: "Upload or link an image.",
      icon: <ImageIcon size={16} />,
      command: ({ editor, range }: any) => {
        const url = window.prompt("Image URL");
        if (url) {
          editor.chain().focus().deleteRange(range).setImage({ src: url }).run();
        }
      },
    },
    {
      group: "Media & Embeds",
      title: "YouTube",
      subtitle: "Embed a video from YouTube.",
      icon: <Youtube size={16} />,
      command: ({ editor, range }: any) => {
        const url = window.prompt("YouTube URL");
        if (url) {
          editor.chain().focus().deleteRange(range).setYoutubeVideo({ src: url }).run();
        }
      },
    },

    // --- ADVANCED LAYOUT ---
    {
      group: "Layout & Structure",
      title: "Table",
      subtitle: "Insert a flexible 3x3 table.",
      icon: <Table size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      },
    },
    {
      group: "Layout & Structure",
      title: "Accordion / Details",
      subtitle: "Collapsible content block.",
      icon: <Layout size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).setDetails().run();
      },
    },
    {
      group: "Layout & Structure",
      title: "Table of Contents",
      subtitle: "Auto-generate document links.",
      icon: <TableOfContents size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertTableOfContents().run();
      },
    },

    // --- CODE & SPECIAL ---
    {
      group: "Advanced Nodes",
      title: "Code Block",
      subtitle: "Syntax-highlighted code.",
      icon: <Code size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
      },
    },
    {
      group: "Advanced Nodes",
      title: "Emoji",
      subtitle: "Insert a symbol or icon.",
      icon: <Smile size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).insertEmoji("🚀").run();
      },
    },

    // --- EXPORT ---
    {
      group: "Export Options",
      title: "Export PDF",
      subtitle: "Professional print-ready PDF.",
      icon: <Download size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).run();
        document.dispatchEvent(new CustomEvent("glyph-export-pdf"));
      },
    },
    {
      group: "Export Options",
      title: "Export Word (.docx)",
      subtitle: "Microsoft Word compatible.",
      icon: <FileText size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).run();
        const html = editor.getHTML();
        const content = `<html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
        downloadFile(content, "document.doc", "application/msword");
      },
    },
    {
      group: "Export Options",
      title: "Export Markdown (.md)",
      subtitle: "Clean markdown for developers.",
      icon: <Code2 size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).run();
        const markdown = editor.storage.markdown.getMarkdown();
        downloadFile(markdown, "document.md", "text/markdown");
      },
    },
    {
      group: "Export Options",
      title: "Export Text (.txt)",
      subtitle: "Simple plain text file.",
      icon: <Type size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).run();
        const text = editor.getText();
        downloadFile(text, "document.txt", "text/plain");
      },
    },

    // --- TOOLS ---
    {
      group: "Tools",
      title: "Clear Formatting",
      subtitle: "Reset styles to default.",
      icon: <Eraser size={16} />,
      command: ({ editor, range }: any) => {
        editor.chain().focus().deleteRange(range).clearNodes().unsetAllMarks().run();
      },
    },
  ];

  return items.filter((item) =>
    item.title.toLowerCase().startsWith(query.toLowerCase()) ||
    item.group.toLowerCase().startsWith(query.toLowerCase())
  );
};
