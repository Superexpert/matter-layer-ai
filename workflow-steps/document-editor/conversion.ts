import { marked } from "marked";
import TurndownService from "turndown";

import {
  citationHtmlToMarkdown,
  citationMarkdown,
  legacySourceTextToCitations,
} from "./citations";

export function markdownToEditorHtml(markdown: string) {
  const html = marked.parse(markdown, {
    async: false,
    gfm: true,
  }) as string;

  return html.replace(/<p>(Source:\s[\s\S]*?)<\/p>/g, (_fullMatch, sourceText: string) => {
    const citations = legacySourceTextToCitations(sourceText);

    if (!citations?.length) {
      return `<p>${sourceText}</p>`;
    }

    return `<p>${citations.map(citationMarkdown).join(" ")}</p>`;
  });
}

export function sourceMarkdownToPreviewHtml(markdown: string) {
  const withReadableExtractedRows = markdown.replace(
    /(^|[^\n])\s+(\d{1,2}:\d{2}:\d{2}\s+(?:[A-Z][A-Z0-9-]*|\[[^\]]+\]))/g,
    "$1\n\n$2",
  );
  const previewMarkdown = withReadableExtractedRows
    .replace(/<!--\s*ml:document\s+\{[^]*?\}\s*-->/g, "")
    .replace(
      /<!--\s*ml:page\s+\{\s*"page"\s*:\s*(\d+)\s*\}\s*-->/g,
      (_match, pageNumber: string) => `\n\n### Page ${pageNumber}\n\n`,
    )
    .replace(/<!--\s*ml:overlap\s*-->/g, "\n\n---\n\n")
    .trim();

  return marked.parse(previewMarkdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
}

export function editorHtmlToMarkdown(html: string) {
  const turndown = new TurndownService({
    bulletListMarker: "*",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });

  turndown.addRule("matterLayerCitation", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      typeof (node as Element).getAttribute === "function" &&
      node.getAttribute("data-ml-citation") === "true",
    replacement: (_content, node) => citationHtmlToMarkdown(node as HTMLElement),
  });

  return turndown
    .turndown(html)
    .replace(/^\s*([*-])\s{2,}/gm, "$1 ")
    .trim();
}
