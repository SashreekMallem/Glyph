import type { DocumentType } from '@glyph/schema-library';

const OPTIONS: readonly { value: DocumentType; label: string }[] = [
  { value: 'contract', label: 'Contract' },
  { value: 'resume', label: 'Resume' },
  { value: 'invoice', label: 'Invoice' },
];

interface Props {
  readonly value: DocumentType | null;
  readonly onChange: (next: DocumentType) => void;
}

export function DocumentTypePicker({ value, onChange }: Props): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Document type"
      className="grid grid-cols-3 border border-black/20"
    >
      {OPTIONS.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={selected}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              'px-3 py-2 text-[12px] uppercase tracking-wider transition-colors',
              i > 0 ? 'border-l border-black/20' : '',
              selected
                ? 'bg-charcoal text-white'
                : 'bg-white text-black hover:bg-black/5',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
