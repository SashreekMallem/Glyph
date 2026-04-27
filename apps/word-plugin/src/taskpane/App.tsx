import { useCallback, useEffect, useState } from 'react';

import type { DocumentType } from '@glyph/schema-library';

import { DocumentTypePicker } from './components/DocumentTypePicker';
import { ValidationStatus } from './components/ValidationStatus';
import { FinalizeButton } from './components/FinalizeButton';
import { useDocumentText } from './hooks/useDocumentText';
import { useValidation } from './hooks/useValidation';
import { useFinalize } from './hooks/useFinalize';

export function App(): JSX.Element {
  const [documentType, setDocumentType] = useState<DocumentType | null>(null);
  const { text, refresh, error: readError } = useDocumentText();
  const validation = useValidation(documentType, text);
  const finalize = useFinalize();

  // Refresh text when the user picks a type so validation sees the latest body.
  useEffect(() => {
    if (documentType !== null) {
      void refresh();
    }
  }, [documentType, refresh]);

  const onFinalize = useCallback(async (): Promise<void> => {
    if (documentType === null) return;
    await finalize.run({ documentType, text });
  }, [documentType, text, finalize]);

  const canFinalize =
    documentType !== null &&
    validation.state === 'valid' &&
    finalize.state !== 'running';

  return (
    <div className="flex h-full flex-col gap-6 bg-white px-6 py-6 text-[13px] text-black">
      <header>
        <div className="text-[14px] uppercase tracking-[0.22em] text-charcoal">
          Glyph
        </div>
        <div className="mt-1 h-px w-full bg-black/10" />
      </header>

      <section className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wider text-black/60">
          Document type
        </label>
        <DocumentTypePicker value={documentType} onChange={setDocumentType} />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-wider text-black/60">
          Validation
        </label>
        {readError !== null ? (
          <p className="text-[12px] text-[#991b1b]">{readError}</p>
        ) : documentType === null ? (
          <p className="text-black/50">Select a document type to begin.</p>
        ) : (
          <ValidationStatus result={validation} />
        )}
      </section>

      <section className="mt-auto flex flex-col gap-2">
        <FinalizeButton
          enabled={canFinalize}
          state={finalize.state}
          onClick={() => {
            void onFinalize();
          }}
        />
        {finalize.state === 'error' && finalize.error !== null ? (
          <p className="text-[12px] text-[#991b1b]">{finalize.error}</p>
        ) : null}
        {finalize.state === 'done' ? (
          <p className="text-[12px] text-black/60">
            Finalized. Encrypted payload embedded as a Custom XML Part.
          </p>
        ) : null}
      </section>
    </div>
  );
}
