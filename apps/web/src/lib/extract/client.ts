/**
 * Browser-side SSE consumer for /api/extract/stream.
 *
 * Captures debounced text deltas, POSTs them with auth, parses the
 * `text/event-stream` response by hand (EventSource can't POST or carry
 * Authorization headers), and surfaces typed callbacks. Single-flight
 * with queueing — if a new delta arrives while a request is in flight,
 * it's buffered and sent once the current one finishes.
 *
 * No DOM globals — runs in workers and node test envs.
 */

import type { ExtractEvent, RFC6902Patch, TokenUsage } from "@glyph/extract";

export interface ExtractClientOptions {
  docId: string;
  schemaType: string;
  endpoint?: string;
  debounceMs?: number;
  /** Max reconnect attempts on transient failure (default 5). */
  maxRetries?: number;
  onPatch?: (patches: RFC6902Patch, seq: number) => void;
  onUsage?: (usage: TokenUsage) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
  /** If provided, awaited per request and passed as Bearer token. */
  getAuthToken?: () => string | null | Promise<string | null>;
}

interface PendingSend {
  textDelta: string;
  fullText?: string;
  clientSeq: number;
}

const DEFAULT_ENDPOINT = "/api/extract/stream";
const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MAX_RETRIES = 5;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000];

export class ExtractClient {
  private readonly opts: Required<
    Omit<
      ExtractClientOptions,
      "onPatch" | "onUsage" | "onError" | "onDone" | "getAuthToken"
    >
  > &
    Pick<
      ExtractClientOptions,
      "onPatch" | "onUsage" | "onError" | "onDone" | "getAuthToken"
    >;

  private buffer = "";
  private latestFullText: string | undefined;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private clientSeq = 0;
  private lastAppliedSeq = -1;
  private sessionId: string | undefined;
  private abort: AbortController | null = null;
  private closed = false;

  constructor(options: ExtractClientOptions) {
    this.opts = {
      endpoint: DEFAULT_ENDPOINT,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
      ...options,
    };
  }

  enqueueDelta(text: string, fullText?: string): void {
    if (this.closed) return;
    if (!text) return;
    this.buffer += text;
    if (fullText !== undefined) this.latestFullText = fullText;
    this.scheduleSend();
  }

  /** Send buffered text immediately (cancels debounce). */
  flush(): void {
    if (this.closed) return;
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    void this.tick();
  }

  /** Abort any in-flight request and stop processing. */
  close(): void {
    this.closed = true;
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.buffer = "";
  }

  private scheduleSend(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      void this.tick();
    }, this.opts.debounceMs);
  }

  private async tick(): Promise<void> {
    if (this.closed) return;
    if (this.inFlight) return;
    if (!this.buffer) return;

    const pending: PendingSend = {
      textDelta: this.buffer,
      fullText: this.latestFullText,
      clientSeq: this.clientSeq++,
    };
    this.buffer = "";
    this.latestFullText = undefined;
    this.inFlight = true;

    try {
      await this.sendWithRetry(pending);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.inFlight = false;
      this.abort = null;
      // Drain queued deltas immediately.
      if (!this.closed && this.buffer) {
        void this.tick();
      }
    }
  }

  private async sendWithRetry(pending: PendingSend): Promise<void> {
    let attempt = 0;
    // Try initial + retries; capped at maxRetries total attempts.
    while (attempt < this.opts.maxRetries) {
      if (this.closed) return;
      try {
        await this.sendOnce(pending);
        return;
      } catch (err) {
        if (this.closed) return;
        if (!isTransient(err)) throw err;
        attempt += 1;
        if (attempt >= this.opts.maxRetries) throw err;
        const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 4000;
        await sleep(delay);
      }
    }
  }

  private async sendOnce(pending: PendingSend): Promise<void> {
    const ac = new AbortController();
    this.abort = ac;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.opts.getAuthToken) {
      const token = await this.opts.getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const body = JSON.stringify({
      docId: this.opts.docId,
      schemaType: this.opts.schemaType,
      textDelta: pending.textDelta,
      fullText: pending.fullText,
      clientSeq: pending.clientSeq,
      sessionId: this.sessionId,
    });

    let res: Response;
    try {
      res = await fetch(this.opts.endpoint, {
        method: "POST",
        headers,
        body,
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      throw err; // surfaces as TypeError -> transient
    }

    // session id may be sent via header
    const hdrSession = res.headers.get("x-session-id");
    if (hdrSession) this.sessionId = hdrSession;

    if (!res.ok) {
      const text = await safeText(res);
      const e = new HttpError(res.status, text || res.statusText);
      throw e;
    }
    if (!res.body) {
      throw new Error("response body missing");
    }

    await this.consumeStream(res.body);
  }

  private async consumeStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let pending = "";

    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });

        // Split on blank-line event delimiters. Accept \n\n or \r\n\r\n.
        let idx: number;
        // Loop in case multiple events arrived in one chunk.
        while ((idx = findEventBoundary(pending)) !== -1) {
          const raw = pending.slice(0, idx);
          pending = pending.slice(idx + boundaryLength(pending, idx));
          this.dispatchRaw(raw);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private dispatchRaw(block: string): void {
    if (!block) return;
    let event = "message";
    const dataLines: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith(":")) continue; // comment / heartbeat
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      // Per spec, a single space after the colon is stripped.
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
      // id / retry / unknown -> ignore
    }

    if (dataLines.length === 0) return;
    const dataStr = dataLines.join("\n");

    let parsed: ExtractEvent | (Record<string, unknown> & { sessionId?: string });
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      // malformed JSON — tolerate and skip
      return;
    }

    // Capture session id if server embedded it in payload.
    const sid = (parsed as { sessionId?: unknown }).sessionId;
    if (typeof sid === "string" && sid) this.sessionId = sid;

    const evt = parsed as ExtractEvent;

    switch (event) {
      case "patch": {
        const seq = typeof evt.seq === "number" ? evt.seq : -1;
        if (seq <= this.lastAppliedSeq) return; // out-of-order / duplicate
        this.lastAppliedSeq = seq;
        if (evt.patches) this.opts.onPatch?.(evt.patches, seq);
        return;
      }
      case "usage":
        if (evt.usage) this.opts.onUsage?.(evt.usage);
        return;
      case "error": {
        const msg = evt.error || "extract stream error";
        this.opts.onError?.(new Error(msg));
        return;
      }
      case "done":
        this.opts.onDone?.();
        return;
      default:
        return;
    }
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(`HTTP ${status}: ${message}`);
    this.name = "HttpError";
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network failure
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return false;
    if (err.status >= 500 && err.status < 600) return true;
    return false;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Find the index where an SSE event ends (start of the blank-line
 * separator). Returns -1 if no complete event yet.
 */
function findEventBoundary(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function boundaryLength(buf: string, idx: number): number {
  return buf.startsWith("\r\n\r\n", idx) ? 4 : 2;
}
