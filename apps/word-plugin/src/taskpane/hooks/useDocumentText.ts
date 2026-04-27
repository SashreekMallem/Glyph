import { useCallback, useEffect, useState } from 'react';

import { readBodyText, OfficeUnavailableError } from '../lib/office';

export interface DocumentTextState {
  readonly text: string;
  readonly error: string | null;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

export function useDocumentText(): DocumentTextState {
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const t = await readBodyText();
      setText(t);
    } catch (e) {
      if (e instanceof OfficeUnavailableError) {
        // Dev mode in a normal browser — harmless.
        setError(null);
        setText('');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { text, error, loading, refresh };
}
