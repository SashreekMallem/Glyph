import type { FinalizeState } from '../hooks/useFinalize';

interface Props {
  readonly enabled: boolean;
  readonly state: FinalizeState['state'];
  readonly onClick: () => void;
}

export function FinalizeButton({ enabled, state, onClick }: Props): JSX.Element {
  const label =
    state === 'running'
      ? 'Finalizing...'
      : state === 'done'
        ? 'Finalized'
        : 'Finalize & Embed';
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={[
        'w-full border border-charcoal px-3 py-3 text-[12px] uppercase tracking-wider transition-colors',
        enabled
          ? 'bg-charcoal text-white hover:bg-black'
          : 'cursor-not-allowed bg-white text-black/30',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
