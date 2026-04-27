import { useCallback, useState } from 'react';

import type { DocumentType } from '@glyph/schema-library';

import { finalize as apiFinalize, ApiError } from '../lib/api';
import { addCustomXmlPart } from '../lib/office';
import { buildStructuredXml } from '../lib/xml';

export type FinalizeState =
  | { readonly state: 'idle'; readonly error: null }
  | { readonly state: 'running'; readonly error: null }
  | { readonly state: 'done'; readonly error: null; readonly partId: string }
  | { readonly state: 'error'; readonly error: string };

export interface FinalizeApi {
  readonly state: FinalizeState['state'];
  readonly error: string | null;
  readonly run: (args: {
    readonly documentType: DocumentType;
    readonly text: string;
  }) => Promise<void>;
}

export function useFinalize(): FinalizeApi {
  const [state, setState] = useState<FinalizeState>({ state: 'idle', error: null });

  const run = useCallback(
    async (args: { readonly documentType: DocumentType; readonly text: string }): Promise<void> => {
      setState({ state: 'running', error: null });
      try {
        const payload = await apiFinalize(args);
        const xml = buildStructuredXml({
          documentType: payload.documentType,
          schemaVersion: payload.schemaVersion,
          encrypted: payload.encrypted,
          iv: payload.iv,
          tag: payload.tag,
          signature: payload.signature,
        });
        const partId = await addCustomXmlPart(xml);
        setState({ state: 'done', error: null, partId });
      } catch (e) {
        const msg =
          e instanceof ApiError || e instanceof Error ? e.message : String(e);
        setState({ state: 'error', error: msg });
      }
    },
    [],
  );

  return {
    state: state.state,
    error: state.state === 'error' ? state.error : null,
    run,
  };
}
