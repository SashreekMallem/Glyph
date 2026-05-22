/**
 * Markdown → DOCX renderer.
 *
 * Same library Claude itself uses for its DOCX skill — `docx` (a.k.a.
 * docx-js). We parse the AI's markdown body with `marked`, walk the AST,
 * and emit professional Word formatting (headings, bold/italic, lists,
 * tables, blockquotes). The resulting .docx is then merged with our
 * existing custom XML part so the signed Glyph payload still rides
 * inside the same file.
 *
 * The merge is deliberately byte-careful: we unzip docx-js's output,
 * inject `customXml/item1.xml` + `customXml/_rels/item1.xml.rels` +
 * `customXml/itemProps1.xml`, register them in `[Content_Types].xml`
 * and `_rels/document.xml.rels`, and re-zip. Word and Pages both open
 * the result; the Glyph payload is invisible to humans but discoverable
 * by `read_glyph_payload`.
 */

import { Marked, type Tokens } from "marked";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  GLYPH_MODERN_PROFILE,
  profileToDocxRun,
  type StyleProfile,
} from "@glyph/style-profile";

const marked = new Marked({
  gfm: true,
  breaks: false,
});

const NUMBERING_REF = "glyph-ordered";

const ORDERED_LEVELS: ILevelsOptions[] = [
  {
    level: 0,
    format: LevelFormat.DECIMAL,
    text: "%1.",
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
  },
  {
    level: 1,
    format: LevelFormat.LOWER_LETTER,
    text: "%2.",
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderDocxOptions {
  /** Document title — rendered as the first heading. */
  readonly title: string;
  /** Markdown body the AI generated. */
  readonly bodyMarkdown: string;
  /**
   * Visual style profile. When omitted, Glyph Modern is used — the
   * built-in default that preserves the pre-Phase-B "Georgia + emerald"
   * look. Pass the document's saved profile to keep exports on-brand.
   */
  readonly styleProfile?: StyleProfile;
}

/**
 * Render markdown to a Word .docx byte buffer. The result is a complete
 * Office Open XML zip; the caller is responsible for merging in any
 * Glyph custom-XML payload via {@link injectGlyphCustomXml}.
 */
export async function renderMarkdownToDocx(
  opts: RenderDocxOptions,
): Promise<Buffer> {
  const profile = opts.styleProfile ?? GLYPH_MODERN_PROFILE;
  const tokens = marked.lexer(opts.bodyMarkdown);
  const children: (Paragraph | Table)[] = [];

  // Title block — heading font, generously sized (≈ h1 * 2 half-points
  // pushed up by another 20% for visual hierarchy), centered, with a
  // subtle bottom border the same as the muted color.
  const h1Run = profileToDocxRun(profile, "h1");
  const titleSize = Math.round(h1Run.size * 1.2); // half-points
  const mutedBorderColor = profile.colors.muted.replace(/^#/, "");
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: opts.title,
          size: titleSize,
          font: h1Run.font,
          color: h1Run.color,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      border: {
        bottom: {
          color: mutedBorderColor,
          space: 1,
          style: BorderStyle.SINGLE,
          size: 4,
        },
      },
    }),
  );

  for (const token of tokens) {
    appendToken(token, children, profile, 0);
  }

  // docx-js page margins are in TWENTIETHS of a point (1 pt = 20 dxa).
  const m = profile.page.margins;
  const pageMargin = {
    top: m.top * 20,
    right: m.right * 20,
    bottom: m.bottom * 20,
    left: m.left * 20,
  };

  const doc = new Document({
    creator: "Glyph",
    title: opts.title,
    styles: defaultStyles(profile),
    numbering: {
      config: [
        { reference: NUMBERING_REF, levels: ORDERED_LEVELS },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: pageMargin },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ---------------------------------------------------------------------------
// Custom XML injection (Glyph payload)
// ---------------------------------------------------------------------------

const GLYPH_NS = "https://glyph.dev/schemas/v1";

export interface InjectGlyphArgs {
  readonly docxBytes: Buffer;
  /** Raw XML string for `customXml/item1.xml`. The caller must build this. */
  readonly customXml: string;
}

/**
 * Inject a Glyph custom-XML payload into a .docx produced by `renderMarkdownToDocx`.
 *
 * We unzip the .docx, append three new parts, patch `[Content_Types].xml`
 * and the document relationships file, and re-zip. The original document
 * body, styles, headers, and fonts are preserved untouched.
 */
export function injectGlyphCustomXml(args: InjectGlyphArgs): Buffer {
  const files = unzipSync(new Uint8Array(args.docxBytes));

  // 1. customXml/item1.xml (the signed payload)
  files["customXml/item1.xml"] = strToU8(args.customXml);

  // 2. customXml/itemProps1.xml (data-store metadata)
  const itemProps =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<ds:datastoreItem ds:itemID="{GLYPH-STRUCTURED-DATA}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">\n` +
    `  <ds:schemaRefs>\n` +
    `    <ds:schemaRef ds:uri="${GLYPH_NS}"/>\n` +
    `  </ds:schemaRefs>\n` +
    `</ds:datastoreItem>`;
  files["customXml/itemProps1.xml"] = strToU8(itemProps);

  // 3. customXml/_rels/item1.xml.rels (item1 → itemProps1 link)
  const itemRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/>\n` +
    `</Relationships>`;
  files["customXml/_rels/item1.xml.rels"] = strToU8(itemRels);

  // 4. Patch [Content_Types].xml to declare the new override.
  const contentTypesRaw = files["[Content_Types].xml"];
  if (!contentTypesRaw) throw new Error("docx is missing [Content_Types].xml");
  let contentTypes = strFromU8(contentTypesRaw);
  if (!contentTypes.includes("customXml/item1.xml")) {
    contentTypes = contentTypes.replace(
      "</Types>",
      `  <Override PartName="/customXml/item1.xml" ContentType="application/xml"/>\n` +
        `  <Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>\n` +
        `</Types>`,
    );
  }
  files["[Content_Types].xml"] = strToU8(contentTypes);

  // 5. Patch word/_rels/document.xml.rels so the document references the
  //    custom XML part — without this Word strips the part on save.
  const docRelsPath = "word/_rels/document.xml.rels";
  const docRelsRaw = files[docRelsPath];
  if (docRelsRaw) {
    let docRels = strFromU8(docRelsRaw);
    if (!docRels.includes("customXml/item1.xml")) {
      const newRelId = nextRelId(docRels);
      docRels = docRels.replace(
        "</Relationships>",
        `  <Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>\n` +
          `</Relationships>`,
      );
      files[docRelsPath] = strToU8(docRels);
    }
  }

  return Buffer.from(zipSync(files));
}

function nextRelId(rels: string): string {
  const ids = Array.from(rels.matchAll(/Id="rId(\d+)"/g)).map((m) =>
    Number.parseInt(m[1] ?? "0", 10),
  );
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return `rId${max + 1}`;
}

// ---------------------------------------------------------------------------
// Markdown AST → docx children
// ---------------------------------------------------------------------------

function appendToken(
  token: Tokens.Generic,
  children: (Paragraph | Table)[],
  profile: StyleProfile,
  listDepth: number,
): void {
  switch (token.type) {
    case "heading":
      children.push(renderHeading(token as Tokens.Heading, profile));
      return;
    case "paragraph":
      children.push(renderParagraph(token as Tokens.Paragraph, profile));
      return;
    case "list":
      renderList(token as Tokens.List, children, profile, listDepth);
      return;
    case "blockquote":
      renderBlockquote(token as Tokens.Blockquote, children, profile);
      return;
    case "code":
      children.push(renderCodeBlock(token as Tokens.Code, profile));
      return;
    case "table":
      children.push(renderTable(token as Tokens.Table, profile));
      return;
    case "hr":
      children.push(renderHr(profile));
      return;
    case "space":
      return;
    case "html":
      // Ignore raw HTML — markdown body should be CommonMark only.
      return;
    default: {
      // Fallback: render the raw text if anything's available.
      const raw = (token as { raw?: string }).raw;
      if (raw && raw.trim().length > 0) {
        const body = profileToDocxRun(profile, "body");
        children.push(
          new Paragraph({
            children: [new TextRun({ text: raw.trim(), ...body })],
          }),
        );
      }
    }
  }
}

function renderHeading(token: Tokens.Heading, profile: StyleProfile): Paragraph {
  const runs = renderInline(token.tokens ?? [], profile, { bold: false });
  const level = clamp(token.depth, 1, 6);
  // h1/h2/h3 read sizes directly from the profile; h4-h6 step down
  // from h3 toward body for the rare deeper-nested heading case.
  const h1 = profileToDocxRun(profile, "h1");
  const h2 = profileToDocxRun(profile, "h2");
  const h3 = profileToDocxRun(profile, "h3");
  const body = profileToDocxRun(profile, "body");
  const runForLevel: Record<number, ReturnType<typeof profileToDocxRun>> = {
    1: h1,
    2: h2,
    3: h3,
    // Below h3 we interpolate toward body so the hierarchy doesn't
    // collapse into a flat block of identical text.
    4: { ...h3, size: Math.max(body.size, h3.size - 2) },
    5: { ...h3, size: Math.max(body.size, h3.size - 4) },
    6: { ...body, size: body.size },
  };
  const heading: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  const styled = runForLevel[level] ?? h3;
  return new Paragraph({
    heading: heading[level],
    children: runs.map((r) =>
      new TextRun({
        ...extractRunOptions(r),
        size: styled.size,
        font: styled.font,
        color: styled.color,
      }),
    ),
    spacing: { before: level <= 2 ? 320 : 200, after: 120 },
  });
}

function renderParagraph(token: Tokens.Paragraph, profile: StyleProfile): Paragraph {
  const runs = renderInline(token.tokens ?? [], profile, { bold: false });
  return new Paragraph({
    children: runs,
    spacing: { after: 120 },
  });
}

function renderList(
  token: Tokens.List,
  children: (Paragraph | Table)[],
  profile: StyleProfile,
  depth: number,
): void {
  for (const item of token.items) {
    const runs = renderInline(item.tokens ?? [], profile, { bold: false });
    children.push(
      new Paragraph({
        children: runs,
        numbering: token.ordered
          ? { reference: NUMBERING_REF, level: Math.min(depth, 1) }
          : undefined,
        bullet: token.ordered ? undefined : { level: Math.min(depth, 4) },
        spacing: { after: 80 },
      }),
    );
    // Nested lists
    if (item.tokens) {
      for (const sub of item.tokens) {
        if (sub.type === "list") {
          renderList(sub as Tokens.List, children, profile, depth + 1);
        }
      }
    }
  }
}

function renderBlockquote(
  token: Tokens.Blockquote,
  children: (Paragraph | Table)[],
  profile: StyleProfile,
): void {
  // Blockquotes pick up the accent color as their left rule, and the
  // muted color for the body text — italic stays a stylistic constant.
  const accent = profile.colors.accent.replace(/^#/, "");
  const muted = profile.colors.muted.replace(/^#/, "");
  for (const sub of token.tokens ?? []) {
    if (sub.type === "paragraph") {
      const runs = renderInline((sub as Tokens.Paragraph).tokens ?? [], profile, {
        italic: true,
      });
      children.push(
        new Paragraph({
          children: runs.map((r) =>
            new TextRun({ ...extractRunOptions(r), italics: true, color: muted }),
          ),
          indent: { left: 360 },
          border: {
            left: {
              color: accent,
              space: 8,
              style: BorderStyle.SINGLE,
              size: 12,
            },
          },
          spacing: { after: 120 },
        }),
      );
    }
  }
}

function renderCodeBlock(token: Tokens.Code, profile: StyleProfile): Paragraph {
  const mono = profileToDocxRun(profile, "mono");
  return new Paragraph({
    children: [new TextRun({ text: token.text, ...mono })],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F4" },
    spacing: { before: 120, after: 160 },
  });
}

function renderTable(token: Tokens.Table, profile: StyleProfile): Table {
  const rows: TableRow[] = [];
  const headerCells = token.header.map(
    (cell: Tokens.TableCell) =>
      new TableCell({
        children: [
          new Paragraph({
            children: renderInline(cell.tokens ?? [], profile, { bold: true }),
          }),
        ],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F4" },
      }),
  );
  rows.push(new TableRow({ children: headerCells, tableHeader: true }));
  for (const row of token.rows) {
    rows.push(
      new TableRow({
        children: row.map(
          (cell: Tokens.TableCell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: renderInline(cell.tokens ?? [], profile, {
                    bold: false,
                  }),
                }),
              ],
            }),
        ),
      }),
    );
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function renderHr(profile: StyleProfile): Paragraph {
  // Rule color tracks the profile's muted color so the page tone stays
  // consistent across themes.
  const muted = profile.colors.muted.replace(/^#/, "");
  return new Paragraph({
    children: [],
    border: {
      bottom: {
        color: muted,
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
    spacing: { before: 160, after: 160 },
  });
}

// ---------------------------------------------------------------------------
// Inline runs (bold/italic/code/link)
// ---------------------------------------------------------------------------

interface InlineCtx {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
  readonly strike?: boolean;
}

function renderInline(
  tokens: Tokens.Generic[],
  profile: StyleProfile,
  ctx: InlineCtx,
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        // marked sometimes hands `text` tokens nested children for emphasis
        if (Array.isArray(tt.tokens) && tt.tokens.length > 0) {
          out.push(...renderInline(tt.tokens, profile, ctx));
        } else {
          out.push(makeRun(tt.text, profile, ctx));
        }
        break;
      }
      case "strong":
        out.push(
          ...renderInline((t as Tokens.Strong).tokens ?? [], profile, {
            ...ctx,
            bold: true,
          }),
        );
        break;
      case "em":
        out.push(
          ...renderInline((t as Tokens.Em).tokens ?? [], profile, {
            ...ctx,
            italic: true,
          }),
        );
        break;
      case "codespan": {
        const mono = profileToDocxRun(profile, "mono");
        out.push(
          new TextRun({
            text: (t as Tokens.Codespan).text,
            ...mono,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F4" },
          }),
        );
        break;
      }
      case "del":
        out.push(
          ...renderInline((t as Tokens.Del).tokens ?? [], profile, {
            ...ctx,
            strike: true,
          }),
        );
        break;
      case "link": {
        const lt = t as Tokens.Link;
        // docx package supports ExternalHyperlink — but importing it adds
        // complexity. For v1 we render link text + URL inline. Polished
        // hyperlinks can be a follow-up.
        const inner = renderInline(lt.tokens ?? [], profile, {
          ...ctx,
          italic: false,
        });
        out.push(...inner);
        out.push(makeRun(` (${lt.href})`, profile, { ...ctx, italic: true }));
        break;
      }
      case "br":
        out.push(new TextRun({ break: 1 }));
        break;
      case "html":
        // skip
        break;
      default: {
        const raw = (t as { raw?: string }).raw;
        if (raw) out.push(makeRun(raw, profile, ctx));
      }
    }
  }
  return out;
}

function makeRun(text: string, profile: StyleProfile, ctx: InlineCtx): TextRun {
  // Code spans take the mono treatment; everything else picks up body.
  const base = profileToDocxRun(profile, ctx.code ? "mono" : "body");
  return new TextRun({
    text,
    bold: ctx.bold,
    italics: ctx.italic,
    strike: ctx.strike,
    ...base,
  });
}

// `docx` doesn't export run options directly; we mirror a subset.
function extractRunOptions(run: ParagraphChild): IRunOptions {
  // ParagraphChild is opaque; we round-trip via `properties`. Simplest:
  // construct from scratch by reading the `text` if available.
  const t = run as unknown as { options?: IRunOptions };
  return t.options ?? {};
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Default styles — every value is now derived from the StyleProfile so
// re-exports of a user-saved profile reproduce the author's intent.
// ---------------------------------------------------------------------------

function defaultStyles(profile: StyleProfile) {
  const body = profileToDocxRun(profile, "body");
  const h1 = profileToDocxRun(profile, "h1");
  const h2 = profileToDocxRun(profile, "h2");
  const h3 = profileToDocxRun(profile, "h3");
  // docx-js `paragraph.spacing.line` is in 240ths-of-a-line, which is
  // equivalent to multiplying line-height by 240.
  const linePacked = Math.round(profile.spacing.line_height * 240);
  const mutedColor = profile.colors.muted.replace(/^#/, "");
  return {
    default: {
      document: {
        run: { font: body.font, size: body.size, color: body.color },
        paragraph: { spacing: { line: linePacked } },
      },
      heading1: { run: { font: h1.font, bold: false, size: h1.size, color: h1.color } },
      heading2: { run: { font: h2.font, bold: false, size: h2.size, color: h2.color } },
      heading3: { run: { font: h3.font, bold: true, size: h3.size, color: h3.color } },
    },
    paragraphStyles: [
      {
        id: "Caption",
        name: "Caption",
        basedOn: "Normal",
        run: {
          font: body.font,
          size: Math.max(profile.sizes.small * 2, 16),
          color: mutedColor,
        },
      },
    ],
  } as const;
}
