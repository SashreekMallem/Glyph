/**
 * Document registry seed (deprecated).
 *
 * The three "built-in" Zod schemas (`Contract`/`Resume`/`Invoice`) have
 * been removed from `@glyph/schema-library` — every document type now
 * lives exclusively in the `document_types` table. The system rows for
 * `contract`/`resume`/`invoice` are already present in the live DB; new
 * environments should seed them via SQL migration rather than from
 * compile-time TS schemas.
 *
 * This script is kept as a stub so old `tsx` invocations don't fail
 * with a missing-file error.
 */

export async function seedDocumentRegistry(): Promise<void> {
  // Intentionally a no-op. See file header.
  // eslint-disable-next-line no-console
  console.log(
    "[seed] document-registry: skipped — schemas now live in the document_types table.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDocumentRegistry()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[seed] failed:", err);
      process.exit(1);
    });
}
