export type CitationData = {
  citedText?: string | null;
  extractionChunkId?: string | null;
  label: string;
  locationLabel?: string | null;
  locationText?: string | null;
  page?: number | null;
  pageEnd?: number | null;
  pageStart?: number | null;
  paragraphNumber?: number | null;
  printableText: string;
  sourceDocumentId?: string | null;
  sourceDocumentName: string;
  surroundingText?: string | null;
};

const CITATION_ATTRIBUTE_NAMES = [
  "data-ml-citation",
  "data-citation-cited-text",
  "data-citation-extraction-chunk-id",
  "data-citation-label",
  "data-citation-location-label",
  "data-citation-location-text",
  "data-citation-page",
  "data-citation-page-end",
  "data-citation-page-start",
  "data-citation-paragraph-number",
  "data-citation-printable-text",
  "data-citation-source-document-id",
  "data-citation-source-document-name",
  "data-citation-surrounding-text",
] as const;

function cleanText(value: string | null | undefined) {
  const trimmedValue = value?.replace(/\s+/g, " ").trim();

  return trimmedValue || null;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripFileExtension(value: string) {
  return value.replace(/\.[a-z0-9]+$/i, "");
}

function citationDocumentTitle(documentName: string | null | undefined) {
  const name = stripFileExtension(cleanText(documentName) ?? "")
    .replace(/^\d{4}-\d{2}-\d{2}\s+/, "")
    .trim();
  return name || "Source";
}

export function buildCitationDisplayLabel(input: {
  documentName?: string | null;
  pageEnd?: number | null;
  pageStart?: number | null;
}) {
  const title = citationDocumentTitle(input.documentName);
  const pageStart = input.pageStart && Number.isInteger(input.pageStart) && input.pageStart > 0
    ? input.pageStart
    : null;
  const pageEnd = input.pageEnd && Number.isInteger(input.pageEnd) && input.pageEnd >= (pageStart ?? 1)
    ? input.pageEnd
    : pageStart;
  if (!pageStart) return title;
  return pageEnd && pageEnd !== pageStart
    ? `${title} pp. ${pageStart}\u2013${pageEnd}`
    : `${title} p. ${pageStart}`;
}

export function formatCitationLabel(input: {
  locationText?: string | null;
  page?: number | null;
  sourceDocumentName: string;
}) {
  const name = citationDocumentTitle(input.sourceDocumentName);
  const locationText = cleanText(input.locationText);

  if (locationText) {
    return `${name} ${locationText}`;
  }

  if (input.page && Number.isInteger(input.page) && input.page > 0) {
    return `${name} p. ${input.page}`;
  }

  return name;
}

export function formatPrintableCitation(input: {
  locationText?: string | null;
  page?: number | null;
  sourceDocumentName: string;
}) {
  const name = citationDocumentTitle(input.sourceDocumentName);
  const locationText = cleanText(input.locationText);

  if (locationText) {
    return `(${name}, ${locationText})`;
  }

  if (input.page && Number.isInteger(input.page) && input.page > 0) {
    return `(${name}, p. ${input.page})`;
  }

  return `(${name})`;
}

export function normalizeCitationData(input: {
  citedText?: string | null;
  extractionChunkId?: string | null;
  label?: string | null;
  locationLabel?: string | null;
  locationText?: string | null;
  page?: number | null;
  pageEnd?: number | null;
  pageStart?: number | null;
  paragraphNumber?: number | null;
  printableText?: string | null;
  sourceDocumentId?: string | null;
  sourceDocumentName: string;
  surroundingText?: string | null;
}): CitationData {
  const sourceDocumentName = cleanText(input.sourceDocumentName);

  if (!sourceDocumentName) {
    throw new Error("Citation source document name is required.");
  }

  const page = input.pageStart ?? input.page;
  const normalizedPage = page && Number.isInteger(page) && page > 0
    ? page
    : null;
  const pageStart = page && Number.isInteger(page) && page > 0 ? page : null;
  const pageEnd = input.pageEnd && pageStart && Number.isInteger(input.pageEnd) && input.pageEnd >= pageStart
    ? input.pageEnd
    : pageStart;
  const paragraphNumber =
    input.paragraphNumber && Number.isInteger(input.paragraphNumber) && input.paragraphNumber > 0
      ? input.paragraphNumber
      : null;
  const locationText = cleanText(input.locationText);
  const label = locationText
    ? `${citationDocumentTitle(sourceDocumentName)} ${locationText}`
    : buildCitationDisplayLabel({ documentName: sourceDocumentName, pageEnd, pageStart });
  const printableText = `(${label.replace(/ (pp?\.) /, ", $1 ")})`;

  return {
    citedText: cleanText(input.citedText),
    extractionChunkId: cleanText(input.extractionChunkId),
    label,
    locationLabel: cleanText(input.locationLabel),
    locationText,
    page: normalizedPage ?? pageStart,
    pageEnd,
    pageStart,
    paragraphNumber,
    printableText,
    sourceDocumentId: cleanText(input.sourceDocumentId),
    sourceDocumentName,
    surroundingText: cleanText(input.surroundingText),
  };
}

export function citationMarkdown(input: {
  citedText?: string | null;
  extractionChunkId?: string | null;
  label?: string | null;
  locationLabel?: string | null;
  locationText?: string | null;
  page?: number | null;
  pageEnd?: number | null;
  pageStart?: number | null;
  paragraphNumber?: number | null;
  printableText?: string | null;
  sourceDocumentId?: string | null;
  sourceDocumentName: string;
  surroundingText?: string | null;
}) {
  const citation = normalizeCitationData(input);
  const attributes = [
    ["data-ml-citation", "true"],
    ["data-citation-label", citation.label],
    ["data-citation-printable-text", citation.printableText],
    ["data-citation-source-document-name", citation.sourceDocumentName],
    citation.citedText
      ? ["data-citation-cited-text", citation.citedText]
      : null,
    citation.extractionChunkId
      ? ["data-citation-extraction-chunk-id", citation.extractionChunkId]
      : null,
    citation.locationLabel
      ? ["data-citation-location-label", citation.locationLabel]
      : null,
    citation.sourceDocumentId
      ? ["data-citation-source-document-id", citation.sourceDocumentId]
      : null,
    citation.page ? ["data-citation-page", String(citation.page)] : null,
    citation.pageStart ? ["data-citation-page-start", String(citation.pageStart)] : null,
    citation.pageEnd ? ["data-citation-page-end", String(citation.pageEnd)] : null,
    citation.paragraphNumber
      ? ["data-citation-paragraph-number", String(citation.paragraphNumber)]
      : null,
    citation.locationText
      ? ["data-citation-location-text", citation.locationText]
      : null,
    citation.surroundingText
      ? ["data-citation-surrounding-text", citation.surroundingText]
      : null,
  ].filter((attribute): attribute is [string, string] => Boolean(attribute));

  return `<span ${attributes
    .map(([name, value]) => `${name}="${escapeHtmlAttribute(value)}"`)
    .join(" ")}>${escapeHtmlAttribute(citation.label)}</span>`;
}

export function printableTextFromCitationAttributes(input: {
  label?: unknown;
  locationText?: unknown;
  page?: unknown;
  printableText?: unknown;
  sourceDocumentName?: unknown;
}) {
  if (typeof input.printableText === "string" && input.printableText.trim()) {
    return input.printableText.trim();
  }

  if (typeof input.sourceDocumentName === "string" && input.sourceDocumentName.trim()) {
    return formatPrintableCitation({
      locationText: typeof input.locationText === "string" ? input.locationText : null,
      page: typeof input.page === "number" ? input.page : null,
      sourceDocumentName: input.sourceDocumentName,
    });
  }

  if (typeof input.label === "string" && input.label.trim()) {
    return `(${input.label.trim()})`;
  }

  return "";
}

export function legacySourceTextToCitations(sourceText: string) {
  const match = /^Source:\s*(.+?)\.?\s*$/.exec(sourceText.trim());
  if (!match) {
    return null;
  }

  return match[1]
    .split(";")
    .map((part) => cleanText(part))
    .filter((part): part is string => Boolean(part))
    .map((part) => {
      const pageMatch = /^(.*?),\s*(p{1,2}\.\s*\d+(?:\s*[-,]\s*\d+)?)$/i.exec(part);
      const sourceDocumentName = pageMatch?.[1]?.trim() || part;
      const locationText = pageMatch?.[2]?.replace(/\s+/g, " ").trim() ?? null;

      return normalizeCitationData({
        label: locationText ? `${sourceDocumentName} ${locationText}` : sourceDocumentName,
        locationText,
        printableText: locationText
          ? `(${sourceDocumentName}, ${locationText})`
          : `(${sourceDocumentName})`,
        sourceDocumentName,
      });
    });
}

export function citationHtmlToMarkdown(element: HTMLElement) {
  const attributes = CITATION_ATTRIBUTE_NAMES
    .map((name) => {
      const value = element.getAttribute(name);

      return value === null ? null : `${name}="${escapeHtmlAttribute(value)}"`;
    })
    .filter((value): value is string => Boolean(value));
  const label = element.getAttribute("data-citation-label") ?? element.textContent ?? "";

  if (!attributes.includes('data-ml-citation="true"')) {
    attributes.unshift('data-ml-citation="true"');
  }

  return `<span ${attributes.join(" ")}>${escapeHtmlAttribute(label)}</span>`;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function citationPageRange(attributes: Map<string, string>) {
  const explicitStart = Number(attributes.get("data-citation-page-start") ?? attributes.get("data-citation-page"));
  const printable = attributes.get("data-citation-printable-text") ?? "";
  const printableMatch = /\bpp?\.\s*(\d+)(?:\s*[\-\u2013]\s*(\d+))?/i.exec(printable);
  const pageStart = Number.isInteger(explicitStart) && explicitStart > 0
    ? explicitStart
    : Number(printableMatch?.[1]);
  const explicitEnd = Number(attributes.get("data-citation-page-end"));
  const pageEnd = Number.isInteger(explicitEnd) && explicitEnd >= pageStart
    ? explicitEnd
    : Number(printableMatch?.[2]) || pageStart;
  return {
    pageEnd: Number.isInteger(pageEnd) && pageEnd > 0 ? pageEnd : undefined,
    pageStart: Number.isInteger(pageStart) && pageStart > 0 ? pageStart : undefined,
  };
}

export function hydrateCitationMarkdown(input: {
  markdown: string;
  sourceDocuments: Array<{ documentId: string; documentName: string }>;
}) {
  const sourceNameById = new Map(
    input.sourceDocuments.map((document) => [document.documentId, document.documentName]),
  );
  return input.markdown.replace(
    /<span\b([^>]*\bdata-ml-citation=(?:"true"|'true')[^>]*)>[\s\S]*?<\/span>/gi,
    (_match, rawAttributes: string) => {
      const attributes = new Map<string, string>();
      for (const match of rawAttributes.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attributes.set(match[1], decodeHtmlAttribute(match[2] ?? match[3] ?? ""));
      }
      const documentId = attributes.get("data-citation-source-document-id")?.trim();
      const resolvedName = documentId
        ? sourceNameById.get(documentId)
        : attributes.get("data-citation-source-document-name")?.trim();
      const { pageEnd, pageStart } = citationPageRange(attributes);
      const label = buildCitationDisplayLabel({ documentName: resolvedName, pageEnd, pageStart });
      attributes.set("data-ml-citation", "true");
      attributes.set("data-citation-label", label);
      attributes.set("data-citation-printable-text", `(${label.replace(/ (pp?\.) /, ", $1 ")})`);
      attributes.set("data-citation-source-document-name", resolvedName ?? "");
      if (pageStart) {
        attributes.set("data-citation-page", String(pageStart));
        attributes.set("data-citation-page-start", String(pageStart));
      }
      if (pageEnd) attributes.set("data-citation-page-end", String(pageEnd));
      const serialized = Array.from(attributes.entries())
        .map(([name, value]) => `${name}="${escapeHtmlAttribute(value)}"`)
        .join(" ");
      return `<span ${serialized}>${escapeHtmlAttribute(label)}</span>`;
    },
  );
}
