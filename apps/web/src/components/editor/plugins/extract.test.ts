/**
 * Unit tests for the real-time extraction plugin.
 *
 * We mock `@/lib/extract/client` so the plugin can be exercised against a
 * real ProseMirror EditorState without hitting any network paths. The mock
 * captures construction options (so callbacks can be fired back into the
 * plugin) plus all `enqueueDelta`/`close` calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "prosemirror-state";
import { Schema } from "prosemirror-model";

// ---------------------------------------------------------------------------
// Mock ExtractClient — captures construction options + method calls.
// ---------------------------------------------------------------------------

interface MockClientInstance {
  options: Record<string, unknown>;
  enqueueDelta: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
}

const created: MockClientInstance[] = [];

vi.mock("@/lib/extract/client", () => {
  return {
    ExtractClient: class {
      constructor(options: Record<string, unknown>) {
        const inst: MockClientInstance = {
          options,
          enqueueDelta: vi.fn(),
          close: vi.fn(),
          flush: vi.fn(),
        };
        created.push(inst);
        // Hand the prototype methods through the captured instance so the
        // plugin's `client.enqueueDelta(...)` calls reach our spies.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).enqueueDelta = inst.enqueueDelta;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).close = inst.close;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).flush = inst.flush;
      }
    },
  };
});

// Import AFTER the mock so the plugin picks up the mocked client.
import {
  extractPlugin,
  extractPluginKey,
  computeDelta,
} from "./extract";

// ---------------------------------------------------------------------------
// Minimal ProseMirror schema — single doc-of-paragraphs-of-text.
// ---------------------------------------------------------------------------

const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
});

function makeDoc(text: string) {
  const para = testSchema.nodes.paragraph.create(
    null,
    text ? testSchema.text(text) : undefined,
  );
  return testSchema.nodes.doc.create(null, [para]);
}

function newState(plugin: ReturnType<typeof extractPlugin>, text = "") {
  return EditorState.create({
    schema: testSchema,
    doc: makeDoc(text),
    plugins: [plugin],
  });
}

beforeEach(() => {
  created.length = 0;
});

// ---------------------------------------------------------------------------
// computeDelta primitives
// ---------------------------------------------------------------------------

describe("computeDelta", () => {
  it("returns empty for identical text", () => {
    expect(computeDelta("hello", "hello")).toBe("");
  });
  it("emits trailing slice for pure appends", () => {
    expect(computeDelta("hello", "hello world")).toBe(" world");
  });
  it("emits REPLACE marker for mid-text edits", () => {
    expect(computeDelta("hello world", "hello brave world")).toBe(
      "[[REPLACE@6:0]]brave ",
    );
  });
  it("emits REPLACE marker for deletions", () => {
    expect(computeDelta("hello world", "hello")).toBe("[[REPLACE@5:6]]");
  });
});

// ---------------------------------------------------------------------------
// Plugin behaviour
// ---------------------------------------------------------------------------

describe("extractPlugin — state holder", () => {
  it("initialises with empty ease + zero seq", () => {
    const state = newState(extractPlugin());
    const slice = extractPluginKey.getState(state);
    expect(slice).toBeDefined();
    expect(slice!.ease).toEqual({});
    expect(slice!.clientSeq).toBe(0);
    expect(slice!.lastSentText).toBe("");
    expect(slice!.sessionId).toBeNull();
    expect(slice!.isStreaming).toBe(false);
  });

  it("does not construct a client when docId is missing", () => {
    const plugin = extractPlugin({ schemaType: "contract" });
    const state = newState(plugin, "hello");
    // Simulate a view by running the plugin's view spec manually.
    const fakeView = { state, dispatch: vi.fn() } as unknown as {
      state: EditorState;
      dispatch: (tr: unknown) => void;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec: any = (plugin as any).spec;
    const v = spec.view(fakeView);
    expect(created.length).toBe(0);
    v.destroy();
  });

  it("apply: doc change updates lastSentText + clientSeq", () => {
    const plugin = extractPlugin();
    let state = newState(plugin, "");
    const before = extractPluginKey.getState(state)!;
    expect(before.lastSentText).toBe("");

    const tr = state.tr.insertText("hello", 1);
    state = state.apply(tr);
    const after = extractPluginKey.getState(state)!;
    expect(after.lastSentText).toBe("hello");
    expect(after.clientSeq).toBe(before.clientSeq + 1);
  });

  it("apply: non-doc-change tr is a no-op", () => {
    const plugin = extractPlugin();
    let state = newState(plugin, "hello");
    const tr = state.tr.insertText("X", 1);
    state = state.apply(tr); // first change registers
    const seq = extractPluginKey.getState(state)!.clientSeq;
    // selection-only tr shouldn't bump anything
    state = state.apply(state.tr);
    expect(extractPluginKey.getState(state)!.clientSeq).toBe(seq);
  });
});

describe("extractPlugin — client wiring", () => {
  function bootView(opts: Parameters<typeof extractPlugin>[0]) {
    const plugin = extractPlugin(opts);
    const fakeView: { state: EditorState; dispatch: ReturnType<typeof vi.fn> } =
      {
        state: newState(plugin, ""),
        dispatch: vi.fn(),
      };
    fakeView.dispatch.mockImplementation((tr: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeView.state = fakeView.state.apply(tr as any);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec: any = (plugin as any).spec;
    const v = spec.view(fakeView);
    return {
      plugin,
      view: v,
      fakeView,
      dispatch: fakeView.dispatch,
      getState: () => fakeView.state,
      setState: (s: EditorState) => {
        fakeView.state = s;
      },
    };
  }

  it("constructs an ExtractClient when docId + schemaType are set", () => {
    const handle = bootView({ docId: "doc-1", schemaType: "contract" });
    expect(created.length).toBe(1);
    expect(created[0]!.options.docId).toBe("doc-1");
    expect(created[0]!.options.schemaType).toBe("contract");
    handle.view.destroy();
  });

  it("doc change forwards a delta to client.enqueueDelta", () => {
    const handle = bootView({ docId: "doc-1", schemaType: "contract" });
    const before = handle.getState();
    const tr = before.tr.insertText("hello", 1);
    const after = before.apply(tr);
    handle.setState(after);
    handle.view.update(handle.fakeView, before);
    expect(created[0]!.enqueueDelta).toHaveBeenCalledTimes(1);
    expect(created[0]!.enqueueDelta).toHaveBeenCalledWith("hello");
    handle.view.destroy();
  });

  it("onPatch meta folds RFC-6902 patches into ease state", () => {
    const handle = bootView({ docId: "doc-1", schemaType: "contract" });
    // Bump clientSeq so the seq=1 patch isn't considered stale.
    const seeded = handle
      .getState()
      .apply(handle.getState().tr.insertText("x", 1));
    handle.setState(seeded);

    const onPatch = created[0]!.options.onPatch as (
      patches: unknown,
      seq: number,
    ) => void;
    onPatch([{ op: "add", path: "/title", value: "Hello" }], 1);

    const slice = extractPluginKey.getState(handle.getState())!;
    expect(slice.ease).toEqual({ title: "Hello" });
    expect(slice.isStreaming).toBe(true);
    handle.view.destroy();
  });

  it("subsequent patches accumulate into ease", () => {
    const handle = bootView({ docId: "doc-1", schemaType: "contract" });
    const seeded = handle
      .getState()
      .apply(handle.getState().tr.insertText("x", 1));
    handle.setState(seeded);

    const onPatch = created[0]!.options.onPatch as (
      patches: unknown,
      seq: number,
    ) => void;
    onPatch([{ op: "add", path: "/title", value: "Hello" }], 1);
    onPatch([{ op: "add", path: "/author", value: "Ada" }], 2);

    expect(extractPluginKey.getState(handle.getState())!.ease).toEqual({
      title: "Hello",
      author: "Ada",
    });
    handle.view.destroy();
  });

  it("onError sets lastError and clears isStreaming", () => {
    const onError = vi.fn();
    const handle = bootView({
      docId: "doc-1",
      schemaType: "contract",
      onError,
    });
    const cb = created[0]!.options.onError as (err: Error) => void;
    cb(new Error("boom"));
    const slice = extractPluginKey.getState(handle.getState())!;
    expect(slice.lastError).toBe("boom");
    expect(slice.isStreaming).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    handle.view.destroy();
  });

  it("onDone clears isStreaming", () => {
    const handle = bootView({ docId: "doc-1", schemaType: "contract" });
    // Force a streaming=true via a patch first.
    const seeded = handle
      .getState()
      .apply(handle.getState().tr.insertText("x", 1));
    handle.setState(seeded);
    const onPatch = created[0]!.options.onPatch as (
      patches: unknown,
      seq: number,
    ) => void;
    onPatch([{ op: "add", path: "/k", value: 1 }], 1);
    expect(extractPluginKey.getState(handle.getState())!.isStreaming).toBe(
      true,
    );

    const onDone = created[0]!.options.onDone as () => void;
    onDone();
    expect(extractPluginKey.getState(handle.getState())!.isStreaming).toBe(
      false,
    );
    handle.view.destroy();
  });

  it("destroy() calls client.close()", () => {
    const handle = bootView({ docId: "doc-1", schemaType: "contract" });
    handle.view.destroy();
    expect(created[0]!.close).toHaveBeenCalledTimes(1);
  });
});
