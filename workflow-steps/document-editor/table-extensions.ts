import { mergeAttributes, Node } from "@tiptap/core";

export const DocumentTable = Node.create({
  name: "table", group: "block", content: "tableRow+", isolating: true,
  parseHTML: () => [{ tag: "table" }],
  renderHTML: ({ HTMLAttributes }) => ["table", mergeAttributes(HTMLAttributes, { class: "document-table" }), ["tbody", 0]],
});

export const DocumentTableRow = Node.create({
  name: "tableRow", content: "(tableHeader|tableCell)+",
  parseHTML: () => [{ tag: "tr" }], renderHTML: ({ HTMLAttributes }) => ["tr", HTMLAttributes, 0],
});

function cellAttributes() {
  return {
    colspan: { default: 1, parseHTML: (element: HTMLElement) => Number(element.getAttribute("colspan") ?? 1), renderHTML: (attrs: { colspan: number }) => attrs.colspan === 1 ? {} : { colspan: attrs.colspan } },
    rowspan: { default: 1, parseHTML: (element: HTMLElement) => Number(element.getAttribute("rowspan") ?? 1), renderHTML: (attrs: { rowspan: number }) => attrs.rowspan === 1 ? {} : { rowspan: attrs.rowspan } },
  };
}

export const DocumentTableHeader = Node.create({
  name: "tableHeader", content: "block+", isolating: true, addAttributes: cellAttributes,
  parseHTML: () => [{ tag: "th" }], renderHTML: ({ HTMLAttributes }) => ["th", HTMLAttributes, 0],
});

export const DocumentTableCell = Node.create({
  name: "tableCell", content: "block+", isolating: true, addAttributes: cellAttributes,
  parseHTML: () => [{ tag: "td" }], renderHTML: ({ HTMLAttributes }) => ["td", HTMLAttributes, 0],
});
