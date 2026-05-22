/**
 * POST /api/v1/documents/import-docx
 *
 * Accepts a user-uploaded `.docx` file (multipart form) and creates a new
 * Glyph document seeded with the parsed Word content. The editor's
 * existing load path then decrypts `prosemirror_encrypted` on open and
 * renders the imported text — extraction kicks in automatically from
 * that point on.
 *
 * Request : multipart/form-data with `file` (.docx Blob), `typeKey`, `title`.
 * Response: `{ docId: string }` on success.
 *
 * Pipeline:
 *   1. Mammoth `convertToHtml({ buffer })` → semantic HTML (headings,
 *      bold/italic, lists, tables — everything Word's style runs encode).
 *   2. `@tiptap/html`'s `generateJSON` → ProseMirror JSON against the
 *      Glyph editor schema (StarterKit + GlyphFieldMark). The schema
 *      list here mirrors `TiptapEditor.tsx` minus the React-only
 *      menu/UI extensions which add no nodes/marks of their own.
 *   3. `extractStyleFromDocx` reads `word/styles.xml` and `word/document.xml`
 *      out of the ZIP to derive a `StyleProfile` (fonts, sizes, margins).
 *   4. Both the PM doc and the StyleProfile are encrypted at-rest using
 *      `@glyph/crypto` and persisted alongside the new document row.
 *
 * Encryption mirrors `documents.create` + `documents.save` in
 * `apps/web/src/server/routers/documents.ts` so the existing reader
 * decrypts seamlessly.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { generateJSON } from "@tiptap/html";
import type { Extensions } from "@tiptap/core";

import { db } from "@/db";
import { documents, documentTypes } from "@/db/schema";
import { encryptPayload } from "@glyph/crypto";
import type { StyleProfile } from "@glyph/style-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractStyleFromDocx } from "@/lib/style/extract-from-docx";
import { GlyphFieldMark } from "@/components/editor/extensions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 10 MiB — matches the dialog/upload limit on the client.
const MAX_BYTES = 10 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface MammothHtmlResult {
  readonly value: string;
  readonly messages: ReadonlyArray<{ readonly type: string; readonly message: string }>;
}

interface MammothModule {
  convertToHtml(input: { buffer: Buffer }): Promise<MammothHtmlResult>;
}

function err(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

/**
 * Editor extensions used to compile the schema for `generateJSON`. We
 * deliberately scope this to schema-contributing extensions — anything
 * that only registers commands / UI / suggestions adds no nodes or marks
 * and so doesn't affect the HTML → JSON conversion. Keeping the list
 * lean keeps the Node-side import surface small (no React-only modules
 * sneaking into the API route's bundle).
 */
const EDITOR_EXTENSIONS: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
  }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: {
      rel: "noopener noreferrer",
    },
  }),
  GlyphFieldMark,
];

/** Default ProseMirror doc when conversion yields no content. */
const EMPTY_PM_DOC: Record<string, unknown> = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  let userId: string | null = null;

  try {
    // 1. Auth (Supabase session cookie).
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return err(401, "unauthorized", "Sign in required.");
    }
    userId = user.id;

    // 2. Parse multipart body.
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return err(400, "bad_request", "Body is not valid multipart/form-data.");
    }

    const fileEntry = form.get("file");
    const typeKeyEntry = form.get("typeKey");
    const titleEntry = form.get("title");

    if (!(fileEntry instanceof Blob)) {
      return err(400, "bad_request", "Missing `file` (must be a Blob).");
    }
    if (typeof typeKeyEntry !== "string" || typeKeyEntry.length === 0) {
      return err(400, "bad_request", "Missing `typeKey`.");
    }
    if (typeof titleEntry !== "string") {
      return err(400, "bad_request", "Missing `title`.");
    }
    const typeKey = typeKeyEntry.trim();
    const title = titleEntry.trim();
    if (typeKey.length === 0 || typeKey.length > 80) {
      return err(400, "bad_request", "`typeKey` must be 1-80 chars.");
    }
    if (title.length === 0 || title.length > 200) {
      return err(400, "bad_request", "`title` must be 1-200 chars.");
    }

    // Optional filename / MIME validation. Blob in Node ships as `File`
    // when uploaded from multipart, so `.name` is present in practice.
    const filename =
      "name" in fileEntry && typeof (fileEntry as File).name === "string"
        ? (fileEntry as File).name
        : "";
    const mime = fileEntry.type || "";
    const looksLikeDocx =
      mime === DOCX_MIME || filename.toLowerCase().endsWith(".docx");
    if (!looksLikeDocx) {
      return err(
        400,
        "bad_request",
        "Only .docx files are accepted for import.",
      );
    }

    // 3. Size guard.
    if (fileEntry.size > MAX_BYTES) {
      return err(
        413,
        "file_too_large",
        `File exceeds the ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit.`,
      );
    }
    if (fileEntry.size === 0) {
      return err(400, "bad_request", "Empty document");
    }

    // 4. Verify the requested type exists + is accessible to this user.
    const [typeRow] = await db
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.key, typeKey))
      .limit(1);
    if (!typeRow) {
      return err(404, "type_not_found", `Unknown document type: ${typeKey}`);
    }
    if (!typeRow.isSystem && typeRow.userId !== userId) {
      return err(403, "forbidden", "You do not have access to that type.");
    }

    // 5. Read the buffer + parse with mammoth + style profile (parallel).
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let mammothMod: MammothModule;
    try {
      mammothMod = (await import("mammoth")) as unknown as MammothModule;
    } catch {
      return err(500, "internal_error", "Could not load .docx parser.");
    }

    let html: string;
    let styleProfile: StyleProfile;
    try {
      const [profile, htmlResult] = await Promise.all([
        extractStyleFromDocx(buffer),
        mammothMod.convertToHtml({ buffer }),
      ]);
      styleProfile = profile;
      html = htmlResult.value;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[import-docx] parse_failed", {
        userId,
        filename,
        error: e instanceof Error ? e.message : String(e),
      });
      return err(422, "parse_failed", "Could not parse .docx file.");
    }

    if (html.trim().length === 0) {
      return err(400, "bad_request", "Empty document");
    }

    // 6. HTML → ProseMirror JSON. `generateJSON` accepts arbitrary HTML
    //    and walks the configured extensions' parseHTML rules to produce
    //    a doc that round-trips through the editor.
    let pmJson: Record<string, unknown>;
    try {
      pmJson = generateJSON(html, EDITOR_EXTENSIONS);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[import-docx] tiptap_convert_failed", {
        userId,
        filename,
        error: e instanceof Error ? e.message : String(e),
      });
      // Fall back to an empty doc so the user still gets a usable document
      // — the original content can be re-imported by hand if needed.
      pmJson = EMPTY_PM_DOC;
    }

    // 7. Encrypt + insert. `documents.documentType` is the coarse
    //    renderer column — always "custom" with the dynamic-schema
    //    setup (matches `documents.create` in the tRPC router).
    const pmEnc = await encryptPayload(pmJson);
    // StyleProfile is itself an object, so it satisfies encryptPayload's
    // `object` parameter directly — no wrapForEncryption needed.
    const styleEnc = await encryptPayload(styleProfile);

    const [row] = await db
      .insert(documents)
      .values({
        userId,
        title,
        documentType: "custom",
        documentTypeKey: typeKey,
        schemaVersion: typeRow.schemaVersion,
        prosemirrorEncrypted: pmEnc.encrypted,
        prosemirrorIv: pmEnc.iv,
        prosemirrorTag: pmEnc.tag,
        styleProfileEncrypted: styleEnc.encrypted,
        styleProfileIv: styleEnc.iv,
        styleProfileTag: styleEnc.tag,
      })
      .returning({ id: documents.id });

    if (!row) {
      return err(500, "internal_error", "Insert returned no row.");
    }

    return NextResponse.json({ docId: row.id }, { status: 200 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[import-docx] error", {
      userId,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    return err(500, "internal_error", "Request failed.");
  } finally {
    // eslint-disable-next-line no-console
    console.log("[import-docx] done", {
      userId,
      durationMs: Date.now() - started,
    });
  }
}

function methodNotAllowed(): NextResponse {
  return err(405, "method_not_allowed", "POST only.");
}
export async function GET(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function PUT(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function DELETE(): Promise<NextResponse> {
  return methodNotAllowed();
}
export async function PATCH(): Promise<NextResponse> {
  return methodNotAllowed();
}
