export type CitationData = {
  citedText?: string | null;
  extractionChunkId?: string | null;
  label: string;
  locationLabel?: string | null;
  locationText?: string | null;
  page?: number | null;
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

export function formatCitationLabel(input: {
  locationText?: string | null;
  page?: number | null;
  sourceDocumentName: string;
}) {
  const name = stripFileExtension(input.sourceDocumentName).trim();
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
  const name = stripFileExtension(input.sourceDocumentName).trim();
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

  const page = input.page && Number.isInteger(input.page) && input.page > 0
    ? input.page
    : null;
  const paragraphNumber =
    input.paragraphNumber && Number.isInteger(input.paragraphNumber) && input.paragraphNumber > 0
      ? input.paragraphNumber
      : null;
  const locationText = cleanText(input.locationText);
  const label = cleanText(input.label) ?? formatCitationLabel({
    locationText,
    page,
    sourceDocumentName,
  });
  const printableText = cleanText(input.printableText) ?? formatPrintableCitation({
    locationText,
    page,
    sourceDocumentName,
  });

  return {
    citedText: cleanText(input.citedText),
    extractionChunkId: cleanText(input.extractionChunkId),
    label,
    locationLabel: cleanText(input.locationLabel),
    locationText,
    page,
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
