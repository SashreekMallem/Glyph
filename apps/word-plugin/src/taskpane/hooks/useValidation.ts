import { useEffect, useState } from 'react';

import type { DocumentType } from '@glyph/schema-library';

import { validate, ApiError, type ZodIssueLite } from '../lib/api';

export type ValidationState =
  | { readonly state: 'idle' }
  | { readonly state: 'running' }
  | {
      readonly state: 'invalid';
      readonly extracted: unknown;
      readonly errors: ReadonlyArray<ZodIssueLite>;
      readonly valid: false;
    }
  | {
      readonly state: 'valid';
      readonly extracted: unknown;
      readonly errors: ReadonlyArray<ZodIssueLite>;
      readonly valid: true;
    }
  | { readonly state: 'error'; readonly error: string };

export function useValidation(
  documentType: DocumentType | null,
  text: string,
): ValidationState {
  const [state, setState] = useState<ValidationState>({ state: 'idle' });

  useEffect(() => {
    if (documentType === null) {
      setState({ state: 'idle' });
      return;
    }
    if (text.trim().length === 0) {
      setState({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ state: 'running' });
    const timer = setTimeout(() => {
      void validate({ documentType, text })
        .then((r) => {
          if (cancelled) return;
          if (r.valid) {
            setState({
              state: 'valid',
              extracted: r.extracted,
              errors: r.errors,
              valid: true,
            });
          } else {
            setState({
              state: 'invalid',
              extracted: r.extracted,
              errors: r.errors,
              valid: false,
            });
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const msg =
            e instanceof ApiError || e instanceof Error ? e.message : String(e);
          setState({ state: 'error', error: msg });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentType, text]);

  return state;
}
