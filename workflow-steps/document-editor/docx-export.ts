import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
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

const DEFAULT_EXPORT_FILE_NAME = "Matter Document.docx";

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

function headingLevelForNode(node: TipTapNode) {
  const level = Number(node.attrs?.level);

  if (level === 1) {
    return HeadingLevel.HEADING_1;
  }

  if (level === 2) {
    return HeadingLevel.HEADING_2;
  }

  return HeadingLevel.HEADING_3;
}

function textRunForNode(node: TipTapNode) {
  const marks = node.marks ?? [];
  const linkMark = marks.find((mark) => mark.type === "link");
  const textRun = new TextRun({
    bold: marks.some((mark) => mark.type === "bold"),
    italics: marks.some((mark) => mark.type === "italic"),
    text: node.text ?? "",
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
        text: printableTextFromCitationAttributes({
          label: node.attrs?.label,
          locationText: node.attrs?.locationText,
          page: node.attrs?.page,
          printableText: node.attrs?.printableText,
          sourceDocumentName: node.attrs?.sourceDocumentName,
        }),
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
  kind: "bullet" | "number";
  level: number;
}) {
  const paragraphs: Paragraph[] = [];

  for (const child of item.content ?? []) {
    if (child.type === "paragraph") {
      paragraphs.push(new Paragraph({
        bullet: options.kind === "bullet" ? { level: options.level } : undefined,
        children: inlineChildren(child.content),
        numbering: options.kind === "number"
          ? {
              level: options.level,
              reference: "ordered-list",
            }
          : undefined,
      }));
      continue;
    }

    paragraphs.push(...paragraphsFromNode(child, options.level + 1));
  }

  return paragraphs;
}

function paragraphsFromNode(node: TipTapNode, listLevel = 0): Paragraph[] {
  if (node.type === "heading") {
    return [new Paragraph({
      children: inlineChildren(node.content),
      heading: headingLevelForNode(node),
    })];
  }

  if (node.type === "paragraph") {
    return [new Paragraph({
      children: inlineChildren(node.content),
    })];
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    return (node.content ?? []).flatMap((item) =>
      paragraphsFromListItem(item, {
        kind: node.type === "bulletList" ? "bullet" : "number",
        level: listLevel,
      }),
    );
  }

  return (node.content ?? []).flatMap((child) => paragraphsFromNode(child, listLevel));
}

export async function generateDocxBlobFromEditorJson(input: {
  editorJson: unknown;
  title: string;
}) {
  if (!isTipTapNode(input.editorJson)) {
    throw new Error("Editor content must be TipTap JSON.");
  }

  const children = input.editorJson.content?.flatMap((node) => paragraphsFromNode(node)) ?? [];
  const document = new Document({
    numbering: {
      config: [
        {
          levels: [
            {
              format: "decimal",
              level: 0,
              text: "%1.",
            },
            {
              format: "lowerLetter",
              level: 1,
              text: "%2.",
            },
            {
              format: "lowerRoman",
              level: 2,
              text: "%3.",
            },
          ],
          reference: "ordered-list",
        },
      ],
    },
    sections: [
      {
        children: children.length ? children : [new Paragraph("")],
      },
    ],
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
