export type ChronologyMarkdownWindow = {
  documentId: string;
  fileName: string;
  markdown: string;
  pageEnd: number | null;
  pageStart: number | null;
  windowIndex: number;
};

type CreateWindowsInput = {
  documentId: string;
  fileName: string;
  markdown: string;
  overlapCharacters?: number;
  targetWindowCharacters?: number;
};

type MarkdownSegment = {
  markdown: string;
  page: number | null;
};

const PAGE_MARKER_PATTERN = /<!--\s*ml:page\s+({[^>]+})\s*-->/g;

function pageNumberFromMarker(markerJson: string) {
  try {
    const parsed = JSON.parse(markerJson) as { page?: unknown };

    return typeof parsed.page === "number" && Number.isInteger(parsed.page)
      ? parsed.page
      : null;
  } catch {
    return null;
  }
}

function splitIntoPageSegments(markdown: string): MarkdownSegment[] {
  const matches = [...markdown.matchAll(PAGE_MARKER_PATTERN)];

  if (matches.length === 0) {
    return [
      {
        markdown,
        page: null,
      },
    ];
  }

  const preamble = markdown.slice(0, matches[0].index).trim();
  const segments: MarkdownSegment[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const markerAndPage = markdown.slice(start, end).trim();
    const page = pageNumberFromMarker(match[1] ?? "{}");

    segments.push({
      markdown: [index === 0 ? preamble : "", markerAndPage]
        .filter(Boolean)
        .join("\n\n"),
      page,
    });
  }

  return segments;
}

function pageRange(segments: MarkdownSegment[]) {
  const pages = segments
    .map((segment) => segment.page)
    .filter((page): page is number => typeof page === "number");

  if (pages.length === 0) {
    return {
      pageEnd: null,
      pageStart: null,
    };
  }

  return {
    pageEnd: Math.max(...pages),
    pageStart: Math.min(...pages),
  };
}

function overlapFromPrevious(markdown: string, overlapCharacters: number) {
  if (overlapCharacters <= 0 || markdown.length <= overlapCharacters) {
    return markdown;
  }

  return markdown.slice(markdown.length - overlapCharacters);
}

export function createChronologyMarkdownWindows({
  documentId,
  fileName,
  markdown,
  overlapCharacters = 3000,
  targetWindowCharacters = 24000,
}: CreateWindowsInput): ChronologyMarkdownWindow[] {
  if (markdown.length <= targetWindowCharacters) {
    const range = pageRange(splitIntoPageSegments(markdown));

    return [
      {
        documentId,
        fileName,
        markdown,
        pageEnd: range.pageEnd,
        pageStart: range.pageStart,
        windowIndex: 0,
      },
    ];
  }

  const segments = splitIntoPageSegments(markdown);
  const windows: ChronologyMarkdownWindow[] = [];
  let currentSegments: MarkdownSegment[] = [];
  let currentMarkdown = "";

  function pushWindow() {
    if (currentSegments.length === 0) {
      return;
    }

    const range = pageRange(currentSegments);
    const previous = windows[windows.length - 1];
    const overlap = previous
      ? overlapFromPrevious(previous.markdown, overlapCharacters)
      : "";
    const body = currentMarkdown.trim();

    windows.push({
      documentId,
      fileName,
      markdown: [overlap ? `<!-- ml:overlap -->\n${overlap}` : "", body]
        .filter(Boolean)
        .join("\n\n"),
      pageEnd: range.pageEnd,
      pageStart: range.pageStart,
      windowIndex: windows.length,
    });

    currentSegments = [];
    currentMarkdown = "";
  }

  for (const segment of segments) {
    if (
      currentSegments.length > 0 &&
      currentMarkdown.length + segment.markdown.length > targetWindowCharacters
    ) {
      pushWindow();
    }

    currentSegments.push(segment);
    currentMarkdown = [currentMarkdown, segment.markdown]
      .filter(Boolean)
      .join("\n\n");

    if (segment.markdown.length > targetWindowCharacters) {
      pushWindow();
    }
  }

  pushWindow();

  return windows;
}
