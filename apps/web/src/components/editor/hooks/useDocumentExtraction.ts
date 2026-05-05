"use client";

/**
 * Streaming extraction hook.
 *
 * Subscribes a piece of editor text (debounced) to the /api/extract/stream
 * endpoint, accumulates RFC 6902 patches into an EASE-encoded state,
 * decodes the state to a plain JSON object, and flattens it to a
 * `ExtractedField[]` — exactly what the FieldsPanel rail consumes.
 *
 * Not a magic black box: this just wires the existing ExtractClient and
 * `@glyph/extract`'s patch applier together with React state.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { applyPatches, decode, type RFC6902Patch } from "@glyph/extract";

import { ExtractClient } from "@/lib/extract/client";
import type { ExtractedField } from "@/components/editor/FieldsPanel";

// Passthrough schema for decode() — extraction state can be any shape.
const PASSTHROUGH = z.any();

export interface UseDocumentExtractionArgs {
  readonly docId: string;
  readonly schemaType: string;
  readonly text: string;
  /** Skip extraction altogether (e.g. while loading existing content). */
  readonly enabled?: boolean;
}

export interface UseDocumentExtractionResult {
  readonly fields: readonly ExtractedField[];
  readonly streaming: boolean;
  readonly error: string | null;
  /** Last raw decoded JSON. Useful for the toolbar/save mutation. */
  readonly json: unknown;
}

const DEBOUNCE_MS = 350;

export function useDocumentExtraction({
  docId,
  schemaType,
  text,
  enabled = true,
}: UseDocumentExtractionArgs): UseDocumentExtractionResult {
  const clientRef = useRef<ExtractClient | null>(null);
  const easeRef = useRef<unknown>({});
  const [json, setJson] = useState<unknown>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the client lazily on first relevant prop set, tear down on unmount.
  useEffect(() => {
    if (!enabled) return;
    const client = new ExtractClient({
      docId,
      schemaType,
      onPatch: (patches: RFC6902Patch) => {
        try {
          // Fold incoming patches into the running EASE state.
          const fold = applyPatches(easeRef.current, patches);
          easeRef.current = fold.state;
          setStreaming(true);
          // `decode` requires a Zod schema as its second arg; we pass
          // a permissive `any` schema so it passes through untouched.
          setJson(decode(fold.state, PASSTHROUGH));
        } catch {
          // Bad patch — ignore and keep prior state. The next batch usually
          // recovers without resetting.
        }
      },
      onError: (err) => {
        setError(err.message);
        setStreaming(false);
      },
      onDone: () => setStreaming(false),
    });
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, schemaType, enabled]);

  // Push the latest text into the client whenever it changes. The
  // ExtractClient already debounces its own send; we use a lighter
  // throttle here so we don't accumulate enormous deltas mid-typing.
  const lastSentRef = useRef<string>("");
  useEffect(() => {
    if (!enabled) return;
    const client = clientRef.current;
    if (!client) return;
    const t = setTimeout(() => {
      const prev = lastSentRef.current;
      const delta = text.length > prev.length ? text.slice(prev.length) : text;
      lastSentRef.current = text;
      client.enqueueDelta(delta, text);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, enabled]);

  const fields = useMemo<ExtractedField[]>(() => {
    if (!json || typeof json !== "object") return [];
    return flattenLeaves(json as Record<string, unknown>);
  }, [json]);

  return { fields, streaming, error, json };
}

// ---------------------------------------------------------------------------
// Walk a decoded JSON object and emit { path, value } for every leaf.
// ---------------------------------------------------------------------------

function flattenLeaves(
  obj: Record<string, unknown>,
  prefix = "",
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === "__ease__" || k === "display_order") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out.push({ path, value: v });
      continue;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") {
          out.push(
            ...flattenLeaves(
              item as Record<string, unknown>,
              `${path}.${i}`,
            ),
          );
        } else if (item !== null && item !== undefined) {
          out.push({ path: `${path}.${i}`, value: item as never });
        }
      });
      continue;
    }
    if (typeof v === "object") {
      out.push(...flattenLeaves(v as Record<string, unknown>, path));
    }
  }
  return out;
}
