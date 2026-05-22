"use client";

/**
 * `useDocumentDescriptors` — load field descriptors for a document type
 * from the DB-backed registry, falling back to the hardcoded seed file
 * while the network query is in flight or if the type is not found in
 * the DB.
 *
 * The seed file `descriptors.ts` is still the source of truth for SSR
 * initial state + offline development; DB descriptors take over when
 * the user has customized a template.
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import type { FieldDescriptor } from "@/lib/editor/types";

export interface UseDocumentDescriptorsResult {
  readonly descriptors: FieldDescriptor[];
  readonly isLoading: boolean;
  readonly source: "db" | "fallback";
}

export function useDocumentDescriptors(
  documentTypeKey: string,
): UseDocumentDescriptorsResult {
  // Document type keys are now arbitrary strings — there are no compile-time
  // "built-in" descriptors to fall back to. If the DB query misses, we
  // return an empty descriptor list and let the editor render generically.
  void documentTypeKey;
  const fallback = useMemo<FieldDescriptor[]>(() => [], []);

  const query = trpc.documentTypes.getDefaultForKey.useQuery(
    { key: documentTypeKey },
    {
      retry: false,
      staleTime: 60_000,
    },
  );

  if (query.isLoading) {
    return { descriptors: fallback, isLoading: true, source: "fallback" };
  }
  if (query.data && Array.isArray(query.data.template.descriptors)) {
    const fromDb = query.data.template.descriptors as FieldDescriptor[];
    if (fromDb.length > 0) {
      return { descriptors: fromDb, isLoading: false, source: "db" };
    }
  }
  return { descriptors: fallback, isLoading: false, source: "fallback" };
}
