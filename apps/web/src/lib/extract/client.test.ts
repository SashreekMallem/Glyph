import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractClient } from "./client";

// ---------- helpers ----------

function sseResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

/**
 * Returns a Response whose body emits chunks asynchronously, gated by
 * `signal`. Lets us simulate a slow stream that we can abort mid-flight.
 */
function pendingResponse(signal?: AbortSignal): {
  response: Response;
  push: (chunk: string) => void;
  end: () => void;
} {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (signal) {
        signal.addEventListener("abort", () => {
          try {
            controller.error(new DOMException("aborted", "AbortError"));
          } catch {
            /* ignore */
          }
        });
      }
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    end: () => controller.close(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------- tests ----------

describe("ExtractClient — debouncing", () => {
  it("rapid enqueueDelta calls produce one POST after debounceMs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: done\ndata: {"type":"done"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ExtractClient({
      docId: "d1",
      schemaType: "s1",
      debounceMs: 300,
    });

    client.enqueueDelta("a");
    client.enqueueDelta("b");
    client.enqueueDelta("c");

    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    // allow microtask drain
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.textDelta).toBe("abc");
    expect(body.clientSeq).toBe(0);
    client.close();
  });

  it("flush() sends immediately without waiting for debounce", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(['event: done\ndata: {"type":"done"}\n\n']),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ExtractClient({
      docId: "d1",
      schemaType: "s1",
      debounceMs: 5000,
    });
    client.enqueueDelta("hello");
    client.flush();

    // Wait microtasks
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.close();
  });
});

describe("ExtractClient — SSE parser", () => {
  it("invokes onPatch per patch event and onDone at end", async () => {
    const chunks = [
      'event: patch\ndata: {"type":"patch","seq":0,"patches":[{"op":"add","path":"/a","value":1}]}\n\n',
      // multi-line data
      'event: patch\ndata: {"type":"patch","seq":1,\ndata: "patches":[{"op":"add","path":"/b","value":2}]}\n\n',
      ': heartbeat ping\n\n',
      'event: usage\ndata: {"type":"usage","usage":{"promptTokens":1,"cachedTokens":0,"candidatesTokens":1,"totalTokens":2}}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ];
    const fetchMock = vi.fn(async () => sseResponse(chunks));
    vi.stubGlobal("fetch", fetchMock);

    const onPatch = vi.fn();
    const onUsage = vi.fn();
    const onDone = vi.fn();
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      onPatch,
      onUsage,
      onDone,
    });
    client.enqueueDelta("x");
    client.flush();

    await new Promise((r) => setTimeout(r, 20));

    expect(onPatch).toHaveBeenCalledTimes(2);
    expect(onPatch.mock.calls[0]![0]).toEqual([
      { op: "add", path: "/a", value: 1 },
    ]);
    expect(onPatch.mock.calls[1]![0]).toEqual([
      { op: "add", path: "/b", value: 2 },
    ]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("tolerates malformed lines and ignores comments", async () => {
    const chunks = [
      ": this is a comment heartbeat\n\n",
      "garbage line without colon\n\n",
      'event: patch\ndata: {NOT_VALID_JSON\n\n',
      'event: patch\ndata: {"type":"patch","seq":0,"patches":[{"op":"replace","path":"/x","value":9}]}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(chunks)));

    const onPatch = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      onPatch,
      onError,
      onDone,
    });
    client.enqueueDelta("x");
    client.flush();
    await new Promise((r) => setTimeout(r, 20));

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    client.close();
  });

  it("drops out-of-order / duplicate seq patches", async () => {
    const chunks = [
      'event: patch\ndata: {"type":"patch","seq":0,"patches":[{"op":"add","path":"/a","value":1}]}\n\n',
      'event: patch\ndata: {"type":"patch","seq":2,"patches":[{"op":"add","path":"/c","value":3}]}\n\n',
      // older seq should be dropped
      'event: patch\ndata: {"type":"patch","seq":1,"patches":[{"op":"add","path":"/b","value":2}]}\n\n',
      // duplicate
      'event: patch\ndata: {"type":"patch","seq":2,"patches":[{"op":"add","path":"/c","value":3}]}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(chunks)));

    const onPatch = vi.fn();
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      onPatch,
    });
    client.enqueueDelta("x");
    client.flush();
    await new Promise((r) => setTimeout(r, 20));

    expect(onPatch).toHaveBeenCalledTimes(2);
    expect(onPatch.mock.calls.map((c) => c[1])).toEqual([0, 2]);
    client.close();
  });
});

describe("ExtractClient — auth", () => {
  it("adds Authorization header when getAuthToken provided", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(['event: done\ndata: {"type":"done"}\n\n']),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      getAuthToken: async () => "tok-123",
    });
    client.enqueueDelta("x");
    client.flush();
    await new Promise((r) => setTimeout(r, 10));

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
    client.close();
  });

  it("omits Authorization when token is null", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(['event: done\ndata: {"type":"done"}\n\n']),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      getAuthToken: async () => null,
    });
    client.enqueueDelta("x");
    client.flush();
    await new Promise((r) => setTimeout(r, 10));
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    client.close();
  });
});

describe("ExtractClient — reconnect", () => {
  it("retries with exponential backoff on TypeError", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(
        sseResponse(['event: done\ndata: {"type":"done"}\n\n']),
      );
    vi.stubGlobal("fetch", fetchMock);

    const onDone = vi.fn();
    const onError = vi.fn();
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      onDone,
      onError,
    });
    client.enqueueDelta("x");
    client.flush();

    // Drain initial fetch + first failure
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // After 250ms backoff -> attempt 2
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // After 500ms backoff -> attempt 3 succeeds
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("does not retry on 401", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("nope", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn();
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      onError,
    });
    client.enqueueDelta("x");
    client.flush();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("retries on 5xx", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockResolvedValueOnce(
        sseResponse(['event: done\ndata: {"type":"done"}\n\n']),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    const onError = vi.fn();
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      onDone,
      onError,
    });
    client.enqueueDelta("x");
    client.flush();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    client.close();
  });
});

describe("ExtractClient — close()", () => {
  it("aborts in-flight request and stops future sends", async () => {
    let signal: AbortSignal | undefined;
    const handle = { current: null as ReturnType<typeof pendingResponse> | null };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal!;
      handle.current = pendingResponse(signal);
      // start streaming a partial event
      handle.current.push("event: patch\ndata: {");
      return handle.current.response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const onPatch = vi.fn();
    const onError = vi.fn();
    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
      onPatch,
      onError,
    });
    client.enqueueDelta("x");
    client.flush();

    // let request start
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signal!.aborted).toBe(false);

    client.close();
    expect(signal!.aborted).toBe(true);

    // future sends are no-ops
    client.enqueueDelta("y");
    client.flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onPatch).not.toHaveBeenCalled();
  });
});

describe("ExtractClient — single-flight queueing", () => {
  it("buffers deltas during in-flight request and sends when done", async () => {
    let resolveFirst: (() => void) | null = null;
    const firstDone = new Promise<void>((r) => (resolveFirst = r));

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstDone;
        return sseResponse(['event: done\ndata: {"type":"done"}\n\n']);
      })
      .mockImplementationOnce(async () =>
        sseResponse(['event: done\ndata: {"type":"done"}\n\n']),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ExtractClient({
      docId: "d",
      schemaType: "s",
      debounceMs: 0,
    });
    client.enqueueDelta("first");
    client.flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // queue more while in flight
    client.enqueueDelta("second");
    client.enqueueDelta("third");
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // release first
    resolveFirst!();
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      fetchMock.mock.calls[1]![1]!.body as string,
    );
    expect(secondBody.textDelta).toBe("secondthird");
    expect(secondBody.clientSeq).toBe(1);
    client.close();
  });
});
