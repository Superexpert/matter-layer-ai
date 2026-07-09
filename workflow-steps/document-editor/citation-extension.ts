import { mergeAttributes, Node } from "@tiptap/core";

export type CitationNodeAttributes = {
  label: string;
  locationText: string | null;
  page: number | null;
  printableText: string;
  sourceDocumentId: string | null;
  sourceDocumentName: string;
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
    const label = String(HTMLAttributes["data-citation-label"] ?? "");

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "aria-label": label ? `Citation: ${label}` : "Citation",
        class: "document-citation-chip",
        "data-ml-citation": "true",
        role: "button",
        tabindex: "0",
      }),
      label,
    ];
  },
});
