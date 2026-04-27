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
): Promise<readonly unknown[]> {
  if (!hasOffice()) throw new OfficeUnavailableError();
  return new Promise<readonly unknown[]>((resolve, reject) => {
    Office.context.document.customXmlParts.getByNamespaceAsync(ns, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        const v = result.value;
        resolve(Array.isArray(v) ? (v as readonly unknown[]) : []);
      } else {
        const msg = result.error?.message ?? 'getByNamespaceAsync failed';
        reject(new OfficeCallError(msg));
      }
    });
  });
}
