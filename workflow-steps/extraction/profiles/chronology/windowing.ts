import { createMarkdownWindows } from "../../markdown-windowing";
import type { ExtractionMarkdownWindow } from "../../types";

export type ChronologyMarkdownWindow = ExtractionMarkdownWindow;

export function createChronologyMarkdownWindows(input: {
  documentId: string;
  fileName: string;
  markdown: string;
  overlapCharacters?: number;
  targetWindowCharacters?: number;
}) {
  return createMarkdownWindows(input);
}
