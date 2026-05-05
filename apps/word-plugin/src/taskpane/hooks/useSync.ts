import { useEffect, useState, useCallback } from 'react';

import { syncDocument, type SyncResponse, ApiError } from '../lib/api';
import {
  getDocxBytes,
  replaceGlyphCustomXmlPart,
  OfficeUnavailableError,
} from '../lib/office';

/**
 * Self-healing-sync hook.
 *
 * On mount (and on demand via `runSync()`), reads the .docx bytes from
 * Word, POSTs them to `/api/v1/sync`, and — when the server reports drift —
 * writes the refreshed Custom XML Part back into the document so the
 * embedded JSON catches up to the visible text.
 *
 * API key resolution: `localStorage.glyph_api_key` for now. Replace with
 * proper auth wiring (Office RoamingSettings + central settings panel)
 * once that lands.
 */

function readApiKey(): string | null {
  try {
    const key = localStorage.getItem('glyph_api_key');
    return key && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export interface UseSyncResult {
  readonly syncing: boolean;
  readonly lastSync: SyncResponse | null;
  readonly error: string | null;
  readonly runSync: () => Promise<void>;
}

export function useSync(): UseSyncResult {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSync = useCallback(async () => {
    setError(null);
    const apiKey = readApiKey();
    if (apiKey === null) {
      setError('Missing Glyph API key (set localStorage.glyph_api_key).');
      return;
    }
    setSyncing(true);
    try {
      const bytes = await getDocxBytes();
      const result = await syncDocument(bytes, apiKey);
      setLastSync(result);
      if (result.status === 'synced' && result.embedded_xml !== null) {
        await replaceGlyphCustomXmlPart(result.embedded_xml);
      }
    } catch (e) {
      if (e instanceof OfficeUnavailableError) {
        setError('Office.js is not available — sync skipped.');
      } else if (e instanceof ApiError) {
        setError(`Sync failed (${e.status}): ${e.message}`);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void runSync();
  }, [runSync]);

  return { syncing, lastSync, error, runSync };
}
