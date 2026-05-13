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

const marked = new Marked({
  gfm: true,
  breaks: false,
});

const SERIF_FONT = "Georgia";
const SANS_FONT = "Aptos";
const MONO_FONT = "JetBrains Mono";

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
}

/**
 * Render markdown to a Word .docx byte buffer. The result is a complete
 * Office Open XML zip; the caller is responsible for merging in any
 * Glyph custom-XML payload via {@link injectGlyphCustomXml}.
 */
export async function renderMarkdownToDocx(
  opts: RenderDocxOptions,
): Promise<Buffer> {
  const tokens = marked.lexer(opts.bodyMarkdown);
  const children: (Paragraph | Table)[] = [];

  // Title block — serif, large, centered, with a subtle bottom border.
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: opts.title, size: 56, font: SERIF_FONT, color: "111111" }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      border: {
        bottom: {
          color: "DDDDDD",
          space: 1,
          style: BorderStyle.SINGLE,
          size: 4,
        },
      },
    }),
  );

  for (const token of tokens) {
    appendToken(token, children, 0);
  }

  const doc = new Document({
    creator: "Glyph",
    title: opts.title,
    styles: defaultStyles(),
    numbering: {
      config: [
        { reference: NUMBERING_REF, levels: ORDERED_LEVELS },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } },
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
  listDepth: number,
): void {
  switch (token.type) {
    case "heading":
      children.push(renderHeading(token as Tokens.Heading));
      return;
    case "paragraph":
      children.push(renderParagraph(token as Tokens.Paragraph));
      return;
    case "list":
      renderList(token as Tokens.List, children, listDepth);
      return;
    case "blockquote":
      renderBlockquote(token as Tokens.Blockquote, children);
      return;
    case "code":
      children.push(renderCodeBlock(token as Tokens.Code));
      return;
    case "table":
      children.push(renderTable(token as Tokens.Table));
      return;
    case "hr":
      children.push(renderHr());
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
        children.push(
          new Paragraph({
            children: [new TextRun({ text: raw.trim(), font: SERIF_FONT, size: 22 })],
          }),
        );
      }
    }
  }
}

function renderHeading(token: Tokens.Heading): Paragraph {
  const runs = renderInline(token.tokens ?? [], { bold: false });
  const level = clamp(token.depth, 1, 6);
  const sizes: Record<number, number> = { 1: 40, 2: 32, 3: 26, 4: 22, 5: 20, 6: 18 };
  const heading: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  return new Paragraph({
    heading: heading[level],
    children: runs.map((r) =>
      new TextRun({
        ...extractRunOptions(r),
        size: sizes[level],
        font: SERIF_FONT,
        color: "111111",
      }),
    ),
    spacing: { before: level <= 2 ? 320 : 200, after: 120 },
  });
}

function renderParagraph(token: Tokens.Paragraph): Paragraph {
  const runs = renderInline(token.tokens ?? [], { bold: false });
  return new Paragraph({
    children: runs,
    spacing: { after: 120 },
  });
}

function renderList(
  token: Tokens.List,
  children: (Paragraph | Table)[],
  depth: number,
): void {
  for (const item of token.items) {
    const runs = renderInline(item.tokens ?? [], { bold: false });
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
          renderList(sub as Tokens.List, children, depth + 1);
        }
      }
    }
  }
}

function renderBlockquote(
  token: Tokens.Blockquote,
  children: (Paragraph | Table)[],
): void {
  for (const sub of token.tokens ?? []) {
    if (sub.type === "paragraph") {
      const runs = renderInline((sub as Tokens.Paragraph).tokens ?? [], {
        italic: true,
      });
      children.push(
        new Paragraph({
          children: runs.map((r) =>
            new TextRun({ ...extractRunOptions(r), italics: true, color: "555555" }),
          ),
          indent: { left: 360 },
          border: {
            left: {
              color: "10B981",
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

function renderCodeBlock(token: Tokens.Code): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: token.text, font: MONO_FONT, size: 20, color: "111111" }),
    ],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F4" },
    spacing: { before: 120, after: 160 },
  });
}

function renderTable(token: Tokens.Table): Table {
  const rows: TableRow[] = [];
  const headerCells = token.header.map(
    (cell: Tokens.TableCell) =>
      new TableCell({
        children: [
          new Paragraph({
            children: renderInline(cell.tokens ?? [], { bold: true }),
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
                  children: renderInline(cell.tokens ?? [], { bold: false }),
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

function renderHr(): Paragraph {
  return new Paragraph({
    children: [],
    border: {
      bottom: {
        color: "DDDDDD",
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
  ctx: InlineCtx,
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        // marked sometimes hands `text` tokens nested children for emphasis
        if (Array.isArray(tt.tokens) && tt.tokens.length > 0) {
          out.push(...renderInline(tt.tokens, ctx));
        } else {
          out.push(makeRun(tt.text, ctx));
        }
        break;
      }
      case "strong":
        out.push(
          ...renderInline((t as Tokens.Strong).tokens ?? [], { ...ctx, bold: true }),
        );
        break;
      case "em":
        out.push(
          ...renderInline((t as Tokens.Em).tokens ?? [], { ...ctx, italic: true }),
        );
        break;
      case "codespan":
        out.push(
          new TextRun({
            text: (t as Tokens.Codespan).text,
            font: MONO_FONT,
            size: 20,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F4" },
          }),
        );
        break;
      case "del":
        out.push(
          ...renderInline((t as Tokens.Del).tokens ?? [], { ...ctx, strike: true }),
        );
        break;
      case "link": {
        const lt = t as Tokens.Link;
        // docx package supports ExternalHyperlink — but importing it adds
        // complexity. For v1 we render link text + URL inline. Polished
        // hyperlinks can be a follow-up.
        const inner = renderInline(lt.tokens ?? [], { ...ctx, italic: false });
        out.push(...inner);
        out.push(makeRun(` (${lt.href})`, { ...ctx, italic: true }));
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
        if (raw) out.push(makeRun(raw, ctx));
      }
    }
  }
  return out;
}

function makeRun(text: string, ctx: InlineCtx): TextRun {
  return new TextRun({
    text,
    bold: ctx.bold,
    italics: ctx.italic,
    strike: ctx.strike,
    font: ctx.code ? MONO_FONT : SERIF_FONT,
    size: 22,
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
// Default styles — serif body, sans nav, mono code, tight line-height.
// ---------------------------------------------------------------------------

function defaultStyles() {
  return {
    default: {
      document: {
        run: { font: SERIF_FONT, size: 22 },
        paragraph: { spacing: { line: 300 } },
      },
      heading1: { run: { font: SERIF_FONT, bold: false, size: 40, color: "111111" } },
      heading2: { run: { font: SERIF_FONT, bold: false, size: 32, color: "111111" } },
      heading3: { run: { font: SERIF_FONT, bold: true, size: 26, color: "111111" } },
    },
    paragraphStyles: [
      {
        id: "Caption",
        name: "Caption",
        basedOn: "Normal",
        run: { font: SANS_FONT, size: 18, color: "888888" },
      },
    ],
  } as const;
}
