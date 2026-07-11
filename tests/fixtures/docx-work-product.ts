export const representativeWorkProductEditorJson = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Lawyer Memo" }] },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Matter Overview" }] },
    { type: "paragraph", content: [
      { type: "text", text: "The hearing is scheduled for May 14, 2026.", marks: [{ type: "bold" }] },
      { type: "citation", attrs: { printableText: "(Scheduling Notice, p. 1)", sourceDocumentName: "Scheduling Notice.pdf", page: 1 } },
      { type: "citation", attrs: { printableText: "(Initial Filing and Supporting Property Description With a Long Descriptive Name, pp. 2–4)", sourceDocumentName: "Initial Filing.pdf", page: 2 } },
    ] },
    { type: "paragraph", content: [
      { type: "text", text: "A second paragraph includes italic, ", marks: [{ type: "italic" }] },
      { type: "text", text: "underlined", marks: [{ type: "underline" }] },
      { type: "text", text: ", and linked text.", marks: [{ type: "link", attrs: { href: "https://example.com/source" } }] },
    ] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Material Issues" }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Access" }] },
    { type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Preserve current access." }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Evaluate alternate access." }] }] },
    ] },
    { type: "orderedList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Review the filed documents." }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Prepare for the hearing." }] }] },
    ] },
    { type: "table", content: [
      { type: "tableRow", content: [
        { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Issue" }] }] },
        { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Conclusion" }] }] },
      ] },
      { type: "tableRow", content: [
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Total compensation" }] }] },
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "$425,000" }, { type: "citation", attrs: { printableText: "(Condemnor Appraisal, p. 3)", sourceDocumentName: "Condemnor Appraisal.pdf", page: 3 } }] }] },
      ] },
    ] },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted source material remains visually distinct." }] }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Separate Action List" }] },
    { type: "orderedList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "This separate list restarts at one." }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "This separate list continues at two." }] }] },
    ] },
  ],
};
