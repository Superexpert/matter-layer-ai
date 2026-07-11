import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  LevelFormat,
  LineRuleType,
  PageOrientation,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from "docx";

import { printableTextFromCitationAttributes } from "./citations";

type TipTapMark = {
  attrs?: Record<string, unknown>;
  type: string;
};

type TipTapNode = {
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: TipTapMark[];
  text?: string;
  type: string;
};

type ExportContext = {
  nextListInstance: number;
};

const DEFAULT_EXPORT_FILE_NAME = "Matter Document.docx";

export const DOCX_STYLES = {
  blockQuote: { after: 120, color: "4A4A4A", indent: 360, line: 276, size: 22 },
  citation: { color: "595959", size: 18 },
  heading1: { after: 120, before: 240, keepNext: true, size: 30 },
  heading2: { after: 100, before: 200, keepNext: true, size: 26 },
  heading3: { after: 80, before: 160, keepNext: true, size: 23 },
  list: { after: 80, hanging: 360, left: 720, line: 276 },
  page: { height: 15840, margin: 1440, width: 12240 },
  paragraph: { after: 120, line: 276, size: 22 },
  title: { after: 280, before: 0, keepNext: true, size: 38 },
  typography: { color: "000000", font: "Times New Roman" },
} as const;

const STYLE_IDS = {
  blockQuote: "MatterLayerBlockQuote",
  heading1: "MatterLayerHeading1",
  heading2: "MatterLayerHeading2",
  heading3: "MatterLayerHeading3",
  list: "MatterLayerList",
  normal: "MatterLayerNormal",
  title: "MatterLayerTitle",
} as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTipTapNode(value: unknown): value is TipTapNode {
  return isObjectRecord(value) && typeof value.type === "string";
}

export function docxFileNameFromTitle(title: string | null | undefined) {
  const baseName = (title ?? "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return `${baseName || DEFAULT_EXPORT_FILE_NAME.replace(/\.docx$/i, "")}.docx`;
}

function headingStyleForNode(node: TipTapNode) {
  const level = Number(node.attrs?.level);

  if (level === 1) return STYLE_IDS.heading1;
  if (level === 2) return STYLE_IDS.heading2;
  return STYLE_IDS.heading3;
}

function textRunForNode(node: TipTapNode) {
  const marks = node.marks ?? [];
  const linkMark = marks.find((mark) => mark.type === "link");
  const textRun = new TextRun({
    bold: marks.some((mark) => mark.type === "bold"),
    italics: marks.some((mark) => mark.type === "italic"),
    text: node.text ?? "",
    underline: marks.some((mark) => mark.type === "underline") ? {} : undefined,
  });

  if (!linkMark || typeof linkMark.attrs?.href !== "string") {
    return textRun;
  }

  return new ExternalHyperlink({
    children: [textRun],
    link: linkMark.attrs.href,
  });
}

function inlineChildren(nodes: TipTapNode[] | undefined): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  for (const node of nodes ?? []) {
    if (node.type === "text") {
      children.push(textRunForNode(node));
      continue;
    }

    if (node.type === "hardBreak") {
      children.push(new TextRun({ break: 1 }));
      continue;
    }

    if (node.type === "citation") {
      children.push(new TextRun({
        color: DOCX_STYLES.citation.color,
        font: DOCX_STYLES.typography.font,
        size: DOCX_STYLES.citation.size,
        text: ` ${printableTextFromCitationAttributes({
          label: node.attrs?.label,
          locationText: node.attrs?.locationText,
          page: node.attrs?.page,
          printableText: node.attrs?.printableText,
          sourceDocumentName: node.attrs?.sourceDocumentName,
        })}`,
      }));
      continue;
    }

    if (node.content?.length) {
      children.push(...inlineChildren(node.content));
    }
  }

  return children.length ? children : [new TextRun("")];
}

function paragraphsFromListItem(item: TipTapNode, options: {
  context: ExportContext;
  instance: number;
  kind: "bullet" | "number";
  level: number;
}) {
  const paragraphs: Paragraph[] = [];

  for (const child of item.content ?? []) {
    if (child.type === "paragraph") {
      paragraphs.push(new Paragraph({
        children: inlineChildren(child.content),
        numbering: {
          instance: options.instance,
          level: Math.min(options.level, 2),
          reference: options.kind === "number" ? "ordered-list" : "bullet-list",
        },
        style: STYLE_IDS.list,
      }));
      continue;
    }

    paragraphs.push(...paragraphsFromNode(
      child,
      options.level + 1,
      false,
      options.context,
      child.type === `${options.kind === "bullet" ? "bullet" : "ordered"}List`
        ? { instance: options.instance, kind: options.kind }
        : undefined,
    ));
  }

  return paragraphs;
}

function paragraphsFromNode(
  node: TipTapNode,
  listLevel = 0,
  isDocumentTitle = false,
  context: ExportContext = { nextListInstance: 1 },
  inheritedList?: { instance: number; kind: "bullet" | "number" },
): Paragraph[] {
  if (node.type === "heading") {
    return [new Paragraph({
      children: inlineChildren(node.content),
      style: isDocumentTitle ? STYLE_IDS.title : headingStyleForNode(node),
    })];
  }

  if (node.type === "paragraph") {
    if (!(node.content?.length)) return [];
    return [new Paragraph({
      children: inlineChildren(node.content),
      style: STYLE_IDS.normal,
    })];
  }

  if (node.type === "blockquote") {
    return (node.content ?? []).flatMap((child) => {
      if (child.type !== "paragraph" || !child.content?.length) return paragraphsFromNode(child, listLevel, false, context);
      return [new Paragraph({ children: inlineChildren(child.content), style: STYLE_IDS.blockQuote })];
    });
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const kind = node.type === "bulletList" ? "bullet" : "number";
    const instance = inheritedList?.kind === kind
      ? inheritedList.instance
      : context.nextListInstance++;
    return (node.content ?? []).flatMap((item) =>
      paragraphsFromListItem(item, {
        context,
        instance,
        kind,
        level: listLevel,
      }),
    );
  }

  return (node.content ?? []).flatMap((child) => paragraphsFromNode(child, listLevel, false, context));
}

function paragraphStyles() {
  const { typography } = DOCX_STYLES;
  return [
    {
      id: STYLE_IDS.normal, name: "Matter Layer Normal", next: STYLE_IDS.normal, quickFormat: true,
      paragraph: { alignment: AlignmentType.LEFT, spacing: { after: DOCX_STYLES.paragraph.after, line: DOCX_STYLES.paragraph.line, lineRule: LineRuleType.AUTO } },
      run: { color: typography.color, font: typography.font, size: DOCX_STYLES.paragraph.size },
    },
    {
      basedOn: STYLE_IDS.normal, id: STYLE_IDS.title, name: "Matter Layer Title", next: STYLE_IDS.heading1, quickFormat: true,
      paragraph: { keepNext: DOCX_STYLES.title.keepNext, spacing: { after: DOCX_STYLES.title.after, before: DOCX_STYLES.title.before } },
      run: { bold: true, color: typography.color, font: typography.font, size: DOCX_STYLES.title.size },
    },
    ...([1, 2, 3] as const).map((level) => {
      const style = DOCX_STYLES[`heading${level}`];
      return {
        basedOn: STYLE_IDS.normal, id: STYLE_IDS[`heading${level}`], name: `Matter Layer Heading ${level}`, next: STYLE_IDS.normal, quickFormat: true,
        paragraph: { keepNext: style.keepNext, spacing: { after: style.after, before: style.before } },
        run: { bold: true, color: typography.color, font: typography.font, size: style.size },
      };
    }),
    {
      basedOn: STYLE_IDS.normal, id: STYLE_IDS.list, name: "Matter Layer List", next: STYLE_IDS.list, quickFormat: true,
      paragraph: { spacing: { after: DOCX_STYLES.list.after, line: DOCX_STYLES.list.line, lineRule: LineRuleType.AUTO } },
      run: { color: typography.color, font: typography.font, size: DOCX_STYLES.paragraph.size },
    },
    {
      basedOn: STYLE_IDS.normal, id: STYLE_IDS.blockQuote, name: "Matter Layer Block Quote", next: STYLE_IDS.normal, quickFormat: true,
      paragraph: { indent: { left: DOCX_STYLES.blockQuote.indent }, spacing: { after: DOCX_STYLES.blockQuote.after, line: DOCX_STYLES.blockQuote.line, lineRule: LineRuleType.AUTO } },
      run: { color: DOCX_STYLES.blockQuote.color, font: typography.font, italics: true, size: DOCX_STYLES.blockQuote.size },
    },
  ];
}

function numberingLevels(kind: "bullet" | "number") {
  return [0, 1, 2].map((level) => ({
    alignment: AlignmentType.LEFT,
    format: kind === "bullet" ? LevelFormat.BULLET : [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
    level,
    style: {
      paragraph: {
        indent: { hanging: DOCX_STYLES.list.hanging, left: DOCX_STYLES.list.left + level * 360 },
        spacing: { after: DOCX_STYLES.list.after, line: DOCX_STYLES.list.line, lineRule: LineRuleType.AUTO },
      },
      run: { font: DOCX_STYLES.typography.font, size: DOCX_STYLES.paragraph.size },
    },
    text: kind === "bullet" ? ["•", "◦", "▪"][level] : [`%${level + 1}.`, `%${level + 1}.`, `%${level + 1}.`][level],
  }));
}

export async function generateDocxBlobFromEditorJson(input: {
  editorJson: unknown;
  title: string;
}) {
  if (!isTipTapNode(input.editorJson)) {
    throw new Error("Editor content must be TipTap JSON.");
  }

  let titleAssigned = false;
  const context: ExportContext = { nextListInstance: 1 };
  const children = input.editorJson.content?.flatMap((node) => {
    const isTitle = !titleAssigned && node.type === "heading" && Number(node.attrs?.level) === 1;
    if (isTitle) titleAssigned = true;
    return paragraphsFromNode(node, 0, isTitle, context);
  }) ?? [];
  const document = new Document({
    numbering: {
      config: [
        {
          levels: numberingLevels("number"),
          reference: "ordered-list",
        },
        { levels: numberingLevels("bullet"), reference: "bullet-list" },
      ],
    },
    sections: [
      {
        children: children.length ? children : [new Paragraph("")],
        properties: {
          page: {
            margin: { bottom: DOCX_STYLES.page.margin, left: DOCX_STYLES.page.margin, right: DOCX_STYLES.page.margin, top: DOCX_STYLES.page.margin },
            size: { height: DOCX_STYLES.page.height, orientation: PageOrientation.PORTRAIT, width: DOCX_STYLES.page.width },
          },
        },
      },
    ],
    styles: {
      default: {
        document: {
          paragraph: { spacing: { after: DOCX_STYLES.paragraph.after, line: DOCX_STYLES.paragraph.line, lineRule: LineRuleType.AUTO } },
          run: { color: DOCX_STYLES.typography.color, font: DOCX_STYLES.typography.font, size: DOCX_STYLES.paragraph.size },
        },
      },
      paragraphStyles: paragraphStyles(),
    },
    title: input.title,
  });

  return Packer.toBlob(document);
}

export async function exportEditorContentToDocx(input: {
  editorJson: unknown;
  title: string;
}) {
  const blob = await generateDocxBlobFromEditorJson(input);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = docxFileNameFromTitle(input.title);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
