import { describe, it, expect, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import {
  extractDecorationsPlugin,
  extractDecorationsPluginKey,
  findPathAtPos,
} from "./decorations";

// Minimal schema — a doc of paragraphs with text. Indexable in PM:
// pos 0 is before the first paragraph; pos 1 is at the start of its text.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
});

function makeState(text: string, ease: object | null, opts: {
  onSelect?: (path: string) => void;
  getEase?: () => object | null;
} = {}) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text.length ? [schema.text(text)] : []),
  ]);
  let currentEase = ease;
  const plugin = extractDecorationsPlugin({
    getEase: opts.getEase ?? (() => currentEase),
    onSelect: opts.onSelect,
  });
  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  return {
    state,
    plugin,
    setEase(next: object | null) {
      currentEase = next;
    },
  };
}

function decorationsOf(state: EditorState): Decoration[] {
  const ps = extractDecorationsPluginKey.getState(state);
  if (!ps) return [];
  return ps.decorations.find();
}

function pathOf(d: Decoration): string | undefined {
  const spec = (d as unknown as { spec: { glyphPath?: string } }).spec;
  return spec?.glyphPath;
}

describe("extractDecorationsPlugin", () => {
  it("decorates explicit text_span ranges", () => {
    // Doc text: "Alice met Bob"
    //           A  l  i  c  e  _  m  e  t  _  B  o  b
    // text-offset:0  1  2  3  4  5  6  7  8  9 10 11 12
    // doc pos     :1  2  3  4  5  6  7  8  9 10 11 12 13
    const ease = {
      name: { value: "Alice", text_span: { start: 0, end: 5 } },
      friend: { value: "Bob", text_span: { start: 10, end: 13 } },
    };
    const { state } = makeState("Alice met Bob", ease);
    const decos = decorationsOf(state);
    expect(decos).toHaveLength(2);
    const byPath = new Map(decos.map((d) => [pathOf(d)!, d]));
    const name = byPath.get("/name")!;
    const friend = byPath.get("/friend")!;
    expect(name.from).toBe(1);
    expect(name.to).toBe(6);
    expect(friend.from).toBe(11);
    expect(friend.to).toBe(14);
  });

  it("fuzzy-matches when text_span is missing", () => {
    const ease = {
      title: "world", // no span — fuzzy locate
    };
    const { state } = makeState("Hello WORLD!", ease);
    const decos = decorationsOf(state);
    expect(decos).toHaveLength(1);
    expect(pathOf(decos[0]!)).toBe("/title");
    // "world" found case-insensitively at text-offset 6 → doc pos 7..12
    expect(decos[0]!.from).toBe(7);
    expect(decos[0]!.to).toBe(12);
  });

  it("encodes JSON Pointer paths per RFC 6901 (escapes ~ and /)", () => {
    const ease = {
      "a/b": { value: "foo", text_span: { start: 0, end: 3 } },
      "c~d": { value: "bar", text_span: { start: 4, end: 7 } },
    };
    const { state } = makeState("foo bar", ease);
    const decos = decorationsOf(state);
    const paths = new Set(decos.map(pathOf));
    expect(paths.has("/a~1b")).toBe(true);
    expect(paths.has("/c~0d")).toBe(true);
  });

  it("walks EASE-encoded arrays using item_NNNN keys", () => {
    const ease = {
      tags: {
        __ease__: true as const,
        display_order: ["item_0001", "item_0002"],
        item_0001: { value: "foo", text_span: { start: 0, end: 3 } },
        item_0002: { value: "bar", text_span: { start: 4, end: 7 } },
      },
    };
    const { state } = makeState("foo bar", ease);
    const decos = decorationsOf(state);
    const paths = decos.map(pathOf).sort();
    expect(paths).toEqual(["/tags/item_0001", "/tags/item_0002"]);
  });

  it("handleClick on a decorated pos invokes onSelect with path and returns true", () => {
    const onSelect = vi.fn();
    const ease = {
      name: { value: "Alice", text_span: { start: 0, end: 5 } },
    };
    const { state, plugin } = makeState("Alice met Bob", ease, { onSelect });
    const handleClick = plugin.props.handleClick!;
    // pos 3 lies inside "Alice" (doc pos 1..6).
    const fakeView = { state } as Parameters<typeof handleClick>[0];
    const handled = handleClick.call(plugin, fakeView, 3, {} as MouseEvent);
    expect(handled).toBe(true);
    expect(onSelect).toHaveBeenCalledWith("/name");
  });

  it("handleClick outside any decoration returns false and does not invoke onSelect", () => {
    const onSelect = vi.fn();
    const ease = {
      name: { value: "Alice", text_span: { start: 0, end: 5 } },
    };
    const { state, plugin } = makeState("Alice met Bob", ease, { onSelect });
    const handleClick = plugin.props.handleClick!;
    // pos 12 lies inside "Bob" — not decorated.
    const fakeView = { state } as Parameters<typeof handleClick>[0];
    const handled = handleClick.call(plugin, fakeView, 12, {} as MouseEvent);
    expect(handled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("findPathAtPos returns the path for decorated positions, null otherwise", () => {
    const ease = {
      name: { value: "Alice", text_span: { start: 0, end: 5 } },
    };
    const { state } = makeState("Alice met Bob", ease);
    expect(findPathAtPos(state, 3)).toBe("/name");
    expect(findPathAtPos(state, 12)).toBeNull();
  });

  it("memoizes: same EASE ref ⇒ same DecorationSet ref (no rebuild)", () => {
    const ease = {
      name: { value: "Alice", text_span: { start: 0, end: 5 } },
    };
    const { state } = makeState("Alice met Bob", ease);
    const before = extractDecorationsPluginKey.getState(state)!.decorations;

    // Apply a no-op transaction. Doc unchanged, EASE pointer unchanged ⇒
    // plugin state must be referentially identical.
    const tr = state.tr.setMeta("noop", true);
    const next = state.apply(tr);
    const after = extractDecorationsPluginKey.getState(next)!.decorations;
    expect(after).toBe(before);
  });

  it("rebuilds when EASE pointer changes", () => {
    let currentEase: object | null = {
      name: { value: "Alice", text_span: { start: 0, end: 5 } },
    };
    const { state } = makeState("Alice met Bob", currentEase, {
      getEase: () => currentEase,
    });
    const before = extractDecorationsPluginKey.getState(state)!.decorations;
    // Swap to a new object reference — rebuild expected.
    currentEase = {
      friend: { value: "Bob", text_span: { start: 10, end: 13 } },
    };
    const tr = state.tr.setMeta("ease-changed", true);
    const next = state.apply(tr);
    const after = extractDecorationsPluginKey.getState(next)!.decorations;
    expect(after).not.toBe(before);
    const decos = after.find();
    expect(decos).toHaveLength(1);
    expect(pathOf(decos[0]!)).toBe("/friend");
  });

  it("returns an empty DecorationSet when EASE is null", () => {
    const { state } = makeState("hello", null);
    const ps = extractDecorationsPluginKey.getState(state)!;
    expect(ps.decorations).toBe(DecorationSet.empty);
  });

  it("skips fuzzy matches that aren't found in the doc", () => {
    const ease = { title: "missing-substring" };
    const { state } = makeState("hello world", ease);
    expect(decorationsOf(state)).toHaveLength(0);
  });
});
