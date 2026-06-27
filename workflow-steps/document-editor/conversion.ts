import { marked } from "marked";
import TurndownService from "turndown";

export function markdownToEditorHtml(markdown: string) {
  return marked.parse(markdown, {
    async: false,
    gfm: true,
  }) as string;
}

export function editorHtmlToMarkdown(html: string) {
  const turndown = new TurndownService({
    bulletListMarker: "*",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });

  // TODO: Add a future TipTap citation extension and conversion rule for
  // structured source citations. For now citations remain ordinary text.
  return turndown
    .turndown(html)
    .replace(/^\s*([*-])\s{2,}/gm, "$1 ")
    .trim();
}
