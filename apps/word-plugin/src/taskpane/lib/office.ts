/**
 * Thin promise-returning wrappers over Office.js Word APIs.
 *
 * Office.js ambient types come from `@types/office-js` — we rely on them
 * rather than redeclaring globals (which would collide at type-check time).
 * At runtime, `Office` / `Word` are provided by the CDN script tag in
 * `taskpane.html`.
 */

export class OfficeUnavailableError extends Error {
  constructor() {
    super('Office.js is not available in this environment.');
    this.name = 'OfficeUnavailableError';
  }
}

export class OfficeCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeCallError';
  }
}

function hasOffice(): boolean {
  return typeof (globalThis as { Office?: unknown }).Office !== 'undefined';
}

function hasWord(): boolean {
  return typeof (globalThis as { Word?: unknown }).Word !== 'undefined';
}

/** Read the document body as plain text. */
export async function readBodyText(): Promise<string> {
  if (!hasWord()) throw new OfficeUnavailableError();
  return Word.run(async (ctx) => {
    const body = ctx.document.body;
    body.load('text');
    await ctx.sync();
    return body.text;
  });
}

/**
 * Inject a Custom XML Part into the document.
 *
 * Resolves with the newly created part's id (opaque string) or rejects with
 * an {@link OfficeCallError} carrying the underlying message.
 */
export async function addCustomXmlPart(xml: string): Promise<string> {
  if (!hasOffice()) throw new OfficeUnavailableError();
  return new Promise<string>((resolve, reject) => {
    Office.context.document.customXmlParts.addAsync(xml, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        const v = result.value as { id?: string } | undefined;
        resolve(v?.id ?? '');
      } else {
        const msg = result.error?.message ?? 'addAsync failed with no error message';
        reject(new OfficeCallError(msg));
      }
    });
  });
}

/** Look up Custom XML Parts by namespace. Returns opaque handles as unknown[]. */
export async function getCustomXmlPartsByNamespace(
  ns: string,
): Promise<readonly Office.CustomXmlPart[]> {
  if (!hasOffice()) throw new OfficeUnavailableError();
  return new Promise<readonly Office.CustomXmlPart[]>((resolve, reject) => {
    Office.context.document.customXmlParts.getByNamespaceAsync(ns, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        const v = result.value;
        resolve(Array.isArray(v) ? (v as readonly Office.CustomXmlPart[]) : []);
      } else {
        const msg = result.error?.message ?? 'getByNamespaceAsync failed';
        reject(new OfficeCallError(msg));
      }
    });
  });
}

/**
 * Read the entire .docx package as a `Uint8Array`. Uses
 * `getFileAsync(Compressed, ...)` which slices the document into chunks;
 * we iterate `getSliceAsync` then concat. Always closes the file handle.
 */
export async function getDocxBytes(): Promise<Uint8Array> {
  if (!hasOffice()) throw new OfficeUnavailableError();
  return new Promise<Uint8Array>((resolve, reject) => {
    Office.context.document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: 65536 },
      (fileResult) => {
        if (fileResult.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new OfficeCallError(fileResult.error?.message ?? 'getFileAsync failed'));
          return;
        }
        const file = fileResult.value;
        const sliceCount = file.sliceCount;
        const slices: Uint8Array[] = new Array(sliceCount);
        let received = 0;
        let aborted = false;

        const finish = (err: Error | null) => {
          file.closeAsync(() => {
            if (err) reject(err);
            else {
              const total = slices.reduce((s, b) => s + b.length, 0);
              const out = new Uint8Array(total);
              let off = 0;
              for (const s of slices) {
                out.set(s, off);
                off += s.length;
              }
              resolve(out);
            }
          });
        };

        for (let i = 0; i < sliceCount; i++) {
          const idx = i;
          file.getSliceAsync(idx, (sliceResult) => {
            if (aborted) return;
            if (sliceResult.status !== Office.AsyncResultStatus.Succeeded) {
              aborted = true;
              finish(new OfficeCallError(sliceResult.error?.message ?? 'getSliceAsync failed'));
              return;
            }
            const data = sliceResult.value.data as unknown;
            // Office.js can deliver `data` as a number[] in browsers and a
            // Uint8Array on desktop; normalize.
            slices[idx] = data instanceof Uint8Array
              ? data
              : new Uint8Array(data as ArrayLike<number>);
            received++;
            if (received === sliceCount) finish(null);
          });
        }
      },
    );
  });
}

const GLYPH_NS = 'https://glyph.dev/schemas/v1';

function deletePart(part: Office.CustomXmlPart): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    part.deleteAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
      else reject(new OfficeCallError(result.error?.message ?? 'deleteAsync failed'));
    });
  });
}

/**
 * Replace the document's Glyph Custom XML Part with the supplied XML.
 * Deletes any existing parts in the Glyph namespace first to avoid duplicate
 * payloads — readers expect at most one.
 */
export async function replaceGlyphCustomXmlPart(xml: string): Promise<void> {
  const existing = await getCustomXmlPartsByNamespace(GLYPH_NS);
  for (const part of existing) {
    await deletePart(part);
  }
  await addCustomXmlPart(xml);
}
