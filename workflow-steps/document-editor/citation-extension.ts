import { mergeAttributes, Node } from "@tiptap/core";
import { buildCitationDisplayLabel } from "./citations";

export type CitationNodeAttributes = {
  citedText: string | null;
  extractionChunkId: string | null;
  label: string;
  locationLabel: string | null;
  locationText: string | null;
  page: number | null;
  pageEnd: number | null;
  pageStart: number | null;
  paragraphNumber: number | null;
  printableText: string;
  sourceDocumentId: string | null;
  sourceDocumentName: string;
  surroundingText: string | null;
};

function optionalStringAttribute(element: HTMLElement, name: string) {
  const value = element.getAttribute(name)?.trim();

  return value || null;
}

function optionalPositiveIntegerAttribute(element: HTMLElement, name: string) {
  const value = optionalStringAttribute(element, name);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export const CitationNode = Node.create({
  name: "citation",

  atom: true,
  group: "inline",
  inline: true,
  selectable: true,

  addAttributes() {
    return {
      citedText: {
        default: null,
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-cited-text"),
        renderHTML: (attributes) =>
          attributes.citedText
            ? { "data-citation-cited-text": attributes.citedText }
            : {},
      },
      extractionChunkId: {
        default: null,
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-extraction-chunk-id"),
        renderHTML: (attributes) =>
          attributes.extractionChunkId
            ? { "data-citation-extraction-chunk-id": attributes.extractionChunkId }
            : {},
      },
      label: {
        default: "",
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-label") ??
          element.textContent?.trim() ??
          "",
        renderHTML: (attributes) => ({
          "data-citation-label": attributes.label,
        }),
      },
      locationLabel: {
        default: null,
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-location-label"),
        renderHTML: (attributes) =>
          attributes.locationLabel
            ? { "data-citation-location-label": attributes.locationLabel }
            : {},
      },
      locationText: {
        default: null,
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-location-text"),
        renderHTML: (attributes) =>
          attributes.locationText
            ? { "data-citation-location-text": attributes.locationText }
            : {},
      },
      page: {
        default: null,
        parseHTML: (element) => optionalPositiveIntegerAttribute(element, "data-citation-page"),
        renderHTML: (attributes) =>
          attributes.page ? { "data-citation-page": String(attributes.page) } : {},
      },
      pageStart: {
        default: null,
        parseHTML: (element) => optionalPositiveIntegerAttribute(element, "data-citation-page-start") ?? optionalPositiveIntegerAttribute(element, "data-citation-page"),
        renderHTML: (attributes) => attributes.pageStart ? { "data-citation-page-start": String(attributes.pageStart) } : {},
      },
      pageEnd: {
        default: null,
        parseHTML: (element) => optionalPositiveIntegerAttribute(element, "data-citation-page-end") ?? optionalPositiveIntegerAttribute(element, "data-citation-page"),
        renderHTML: (attributes) => attributes.pageEnd ? { "data-citation-page-end": String(attributes.pageEnd) } : {},
      },
      paragraphNumber: {
        default: null,
        parseHTML: (element) =>
          optionalPositiveIntegerAttribute(element, "data-citation-paragraph-number"),
        renderHTML: (attributes) =>
          attributes.paragraphNumber
            ? { "data-citation-paragraph-number": String(attributes.paragraphNumber) }
            : {},
      },
      printableText: {
        default: "",
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-printable-text") ??
          element.textContent?.trim() ??
          "",
        renderHTML: (attributes) => ({
          "data-citation-printable-text": attributes.printableText,
        }),
      },
      sourceDocumentId: {
        default: null,
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-source-document-id"),
        renderHTML: (attributes) =>
          attributes.sourceDocumentId
            ? { "data-citation-source-document-id": attributes.sourceDocumentId }
            : {},
      },
      sourceDocumentName: {
        default: "",
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-source-document-name") ??
          element.textContent?.trim() ??
          "",
        renderHTML: (attributes) => ({
          "data-citation-source-document-name": attributes.sourceDocumentName,
        }),
      },
      surroundingText: {
        default: null,
        parseHTML: (element) =>
          optionalStringAttribute(element, "data-citation-surrounding-text"),
        renderHTML: (attributes) =>
          attributes.surroundingText
            ? { "data-citation-surrounding-text": attributes.surroundingText }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ml-citation="true"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const label = buildCitationDisplayLabel({
      documentName: String(HTMLAttributes["data-citation-source-document-name"] ?? ""),
      pageEnd: Number(HTMLAttributes["data-citation-page-end"] ?? HTMLAttributes["data-citation-page"]),
      pageStart: Number(HTMLAttributes["data-citation-page-start"] ?? HTMLAttributes["data-citation-page"]),
    });

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "aria-label": label ? `Citation: ${label}` : "Citation",
        class: "document-citation-chip",
        "data-ml-citation": "true",
        role: "button",
        tabindex: "0",
        title: label,
      }),
      label,
    ];
  },
});
