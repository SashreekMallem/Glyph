/**
 * POST /api/mcp/v1
 *
 * Glyph's remote MCP endpoint. Speaks JSON-RPC 2.0 over Server-Sent
 * Events so claude.ai web, Claude Desktop's remote-connector path,
 * Cursor, Continue, and any other MCP-compatible host can connect with
 * one click.
 *
 * Same six tool handlers as the stdio server in `packages/mcp-server` —
 * we re-use `listTools()` and `dispatchToolCall()` so there's a single
 * source of truth for tool behavior. This file is purely the wire-protocol
 * adapter.
 *
 * Methods handled:
 *   - initialize           → server capabilities + version
 *   - notifications/initialized  → no response, just acknowledge
 *   - ping                 → empty result
 *   - tools/list           → all six tool definitions
 *   - tools/call           → dispatchToolCall(...)
 *   - everything else      → JSON-RPC -32601 "Method not found"
 */

import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { verifyApiKey } from "@glyph/crypto";
import {
  dispatchToolCall,
  listTools,
  type CreateServerDeps,
} from "@glyph/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_PREFIX_LEN = 16;
const HEARTBEAT_MS = 25_000;
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "glyph";
const SERVER_VERSION = "0.3.0";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? null;
}

function deriveOrigin(req: NextRequest): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(req.url).origin;
}

function buildWwwAuthenticate(req: NextRequest): string {
  const origin = deriveOrigin(req);
  return `Bearer realm="glyph-mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

async function authenticate(
  req: NextRequest,
): Promise<{ userId: string } | { error: NextResponse }> {
  const raw = parseBearer(req.headers.get("authorization"));
  if (!raw || raw.length < API_KEY_PREFIX_LEN) {
    return {
      error: NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32001,
            message: "Unauthorized",
            data: { httpStatus: 401 },
          },
        },
        {
          status: 401,
          // RFC 9728 — tells the MCP client where to find OAuth metadata
          // so it can run the dynamic-client-registration flow.
          headers: { "WWW-Authenticate": buildWwwAuthenticate(req) },
        },
      ),
    };
  }
  const keyPrefix = raw.slice(0, API_KEY_PREFIX_LEN);
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, keyPrefix))
    .limit(1);
  if (!key) {
    return {
      error: NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "Invalid API key", data: { httpStatus: 401 } },
        },
        {
          status: 401,
          headers: { "WWW-Authenticate": buildWwwAuthenticate(req) },
        },
      ),
    };
  }
  const ok = await verifyApiKey(raw, key.keyHash);
  if (!ok) {
    return {
      error: NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "Invalid API key", data: { httpStatus: 401 } },
        },
        {
          status: 401,
          headers: { "WWW-Authenticate": buildWwwAuthenticate(req) },
        },
      ),
    };
  }
  if (!key.isActive) {
    return {
      error: NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "API key revoked", data: { httpStatus: 403 } },
        },
        { status: 403 },
      ),
    };
  }
  return { userId: key.userId };
}

function deriveGlyphApiUrl(req: NextRequest): string {
  // Same-origin so the tool handlers can self-call our other endpoints.
  return deriveOrigin(req);
}

async function handleJsonRpc(
  msg: JsonRpcRequest,
  deps: CreateServerDeps,
): Promise<JsonRpcResponse | null> {
  switch (msg.method) {
    case "initialize": {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };
    }
    case "notifications/initialized": {
      // Notifications get no response. Return null so the caller skips writing.
      return null;
    }
    case "ping": {
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    }
    case "tools/list": {
      return { jsonrpc: "2.0", id: msg.id, result: { tools: listTools() } };
    }
    case "tools/call": {
      const params = (msg.params ?? {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      if (typeof params.name !== "string") {
        return {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: "Missing or invalid `name`" },
        };
      }
      const result = await dispatchToolCall(
        params.name,
        params.arguments,
        deps,
      );
      return { jsonrpc: "2.0", id: msg.id, result };
    }
    default: {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      };
    }
  }
}

/**
 * Single-shot JSON-RPC mode (POST with `Accept: application/json`). This
 * is what most MCP clients use today — they POST one request, get one
 * response. We support the SSE path too for streaming-capable clients.
 */
async function handleSingleShot(
  req: NextRequest,
  deps: CreateServerDeps,
): Promise<NextResponse> {
  let msg: JsonRpcRequest;
  try {
    msg = (await req.json()) as JsonRpcRequest;
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 },
    );
  }
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: msg?.id ?? null,
        error: { code: -32600, message: "Invalid Request" },
      },
      { status: 400 },
    );
  }
  const response = await handleJsonRpc(msg, deps);
  if (!response) {
    // Notification — no body.
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(response);
}

/**
 * SSE mode (POST with `Accept: text/event-stream`). Used by clients that
 * want a persistent stream (claude.ai, Claude Desktop's remote connector).
 * We open a stream, write each response as `data: <json>\n\n`, and emit
 * a keepalive comment every HEARTBEAT_MS to defeat proxy timeouts.
 */
async function handleSse(
  req: NextRequest,
  deps: CreateServerDeps,
): Promise<NextResponse> {
  const body = await req.text();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const safeEnqueue = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          // Stream already closed
        }
      };

      // Heartbeat
      const heartbeat = setInterval(() => {
        safeEnqueue(":keepalive\n\n");
      }, HEARTBEAT_MS);

      // Abort handling
      const onAbort = () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", onAbort, { once: true });

      try {
        let msg: JsonRpcRequest;
        try {
          msg = JSON.parse(body) as JsonRpcRequest;
        } catch {
          safeEnqueue(
            `data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            })}\n\n`,
          );
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        const response = await handleJsonRpc(msg, deps);
        if (response) {
          safeEnqueue(`data: ${JSON.stringify(response)}\n\n`);
        }
      } catch (e) {
        safeEnqueue(
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32603,
              message: "Internal error",
              data: { detail: e instanceof Error ? e.message : String(e) },
            },
          })}\n\n`,
        );
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticate(req);
  if ("error" in auth) return auth.error;

  const bearerToken = parseBearer(req.headers.get("authorization")) ?? undefined;
  const deps: CreateServerDeps = {
    glyphApiUrl: deriveGlyphApiUrl(req),
    fetch: globalThis.fetch.bind(globalThis),
    bearerToken,
  };

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return handleSse(req, deps);
  }
  return handleSingleShot(req, deps);
}

// Connector manifest. Some MCP clients GET this to discover the server's
// metadata before negotiating the JSON-RPC connection.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description:
      "Generate signed, structured documents whose payload downstream consumers read for free.",
    url: new URL("/api/mcp/v1", deriveOrigin(req)).toString(),
    auth: {
      type: "bearer",
      instructions: "Get an API key at /settings/api-keys",
    },
    capabilities: { tools: {} },
    protocolVersion: PROTOCOL_VERSION,
    tools_count: listTools().length,
  });
}
