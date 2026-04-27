import type { ValidationState } from '../hooks/useValidation';

interface Props {
  readonly result: ValidationState;
}

export function ValidationStatus({ result }: Props): JSX.Element {
  if (result.state === 'idle') {
    return <p className="text-black/50">Waiting for document text.</p>;
  }
  if (result.state === 'running') {
    return <p className="text-black/60">Validating...</p>;
  }
  if (result.state === 'error') {
    return <p className="text-[12px] text-[#991b1b]">{result.error}</p>;
  }

  const fieldCount = countFields(result.extracted);
  const valid = result.state === 'valid';

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] text-black/80">
        {valid ? '\u2713' : '\u2717'}{' '}
        {fieldCount} {fieldCount === 1 ? 'field' : 'fields'} detected
      </p>
      {result.errors.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {result.errors.map((e, i) => (
            <li key={i} className="text-[12px] text-[#991b1b]">
              {formatPath(e.path)}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function countFields(obj: unknown): number {
  if (obj === null || typeof obj !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) n += 1;
    } else if (typeof v === 'object') {
      n += countFields(v);
    } else {
      n += 1;
    }
  }
  return n;
}

function formatPath(path: ReadonlyArray<string | number>): string {
  if (path.length === 0) return '(root)';
  return path.map((p) => String(p)).join('.');
}
