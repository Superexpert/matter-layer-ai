import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
  sourceMarkdownToPreviewHtml,
} from "../../workflow-steps/document-editor/conversion";
import {
  assertDocumentEditorStepOutput,
  normalizeDocumentEditorStepConfig,
} from "../../workflow-steps/document-editor/schema";
import {
  DOCX_STYLES,
  docxFileNameFromTitle,
  generateDocxBlobFromEditorJson,
} from "../../workflow-steps/document-editor/docx-export";
import JSZip from "jszip";
import { representativeWorkProductEditorJson } from "../fixtures/docx-work-product";
import {
  buildCitationDisplayLabel,
  citationMarkdown,
  hydrateCitationMarkdown,
} from "../../workflow-steps/document-editor/citations";

describe("document editor schema", () => {
  it("accepts valid config and applies defaults", () => {
    expect(
      normalizeDocumentEditorStepConfig({
        artifactOutputKey: "chronologyArtifactId",
        inputStepId: "extract-chronology",
      }),
    ).toEqual({
      artifactOutputKey: "chronologyArtifactId",
      completionButtonLabel: null,
      contentType: "MARKDOWN",
      documentFileName: null,
      documentTitle: null,
      editor: "tiptap",
      generatedArtifact: null,
      inputStepId: "extract-chronology",
      saveMode: "revision",
    });
  });

  it("rejects missing inputStepId", () => {
    expect(() =>
      normalizeDocumentEditorStepConfig({
        artifactOutputKey: "chronologyArtifactId",
      }),
    ).toThrow("inputStepId");
  });

  it("validates revision and overwrite output shapes", () => {
    expect(
      assertDocumentEditorStepOutput({
        reviewedArtifactId: "artifact_1",
        revisionId: "revision_1",
        savedMatterDocumentId: "document_1",
        sourceArtifactId: "artifact_1",
        status: "completed",
      }),
    ).toMatchObject({
      revisionId: "revision_1",
    });
    expect(
      assertDocumentEditorStepOutput({
        artifactId: "artifact_1",
        savedMatterDocumentId: "document_1",
        status: "completed",
      }),
    ).toMatchObject({
      artifactId: "artifact_1",
    });
  });
});

describe("document editor Markdown conversion", () => {
  it("builds recognizable deterministic citation labels", () => {
    expect(buildCitationDisplayLabel({ documentName: "2026-03-18 Petition in Condemnation.pdf", pageEnd: 2, pageStart: 2 })).toBe("Petition in Condemnation p. 2");
    expect(buildCitationDisplayLabel({ documentName: "2026-02-20 Final Offer Letter - Parcel 14.pdf", pageStart: 1 })).toBe("Final Offer Letter - Parcel 14 p. 1");
    expect(buildCitationDisplayLabel({ documentName: "2026-04-08 Special Commissioners Hearing Notice.pdf", pageEnd: 3, pageStart: 1 })).toBe("Special Commissioners Hearing Notice pp. 1–3");
    expect(buildCitationDisplayLabel({ pageStart: 1 })).toBe("Source p. 1");
  });

  it("hydrates existing generic citations from authoritative source metadata", () => {
    const markdown = hydrateCitationMarkdown({
      markdown: 'Fact <span data-ml-citation="true" data-citation-label="Document p. 2" data-citation-printable-text="(Document, p. 2)" data-citation-source-document-id="petition" data-citation-page="2" data-citation-cited-text="support">Document p. 2</span>.',
      sourceDocuments: [{ documentId: "petition", documentName: "2026-03-18 Petition in Condemnation.pdf" }],
    });
    expect(markdown).toContain('data-citation-source-document-id="petition"');
    expect(markdown).toContain('data-citation-source-document-name="2026-03-18 Petition in Condemnation.pdf"');
    expect(markdown).toContain('data-citation-label="Petition in Condemnation p. 2"');
    expect(markdown).toContain('data-citation-printable-text="(Petition in Condemnation, p. 2)"');
    expect(markdown).toContain('data-citation-cited-text="support"');
    expect(markdown).toContain('>Petition in Condemnation p. 2</span>');

    const inferredPage = hydrateCitationMarkdown({
      markdown: '<span data-ml-citation="true" data-citation-label="Document p. 3" data-citation-printable-text="(2026-04-08 Special Commissioners Hearing Notice.pdf, p. 3)" data-citation-source-document-id="notice">Document p. 3</span>',
      sourceDocuments: [{ documentId: "notice", documentName: "2026-04-08 Special Commissioners Hearing Notice.pdf" }],
    });
    expect(inferredPage).toContain("Special Commissioners Hearing Notice p. 3");
    expect(inferredPage).toContain('data-citation-page="3"');
  });

  it("keeps distinct sources distinguishable and blocks unresolvable stored names", () => {
    const markdown = hydrateCitationMarkdown({
      markdown: [
        '<span data-ml-citation="true" data-citation-label="Document p. 1" data-citation-source-document-id="petition" data-citation-page="1">Document p. 1</span>',
        '<span data-ml-citation="true" data-citation-label="Document p. 1" data-citation-source-document-id="notice" data-citation-source-document-name="Other Matter Secret.pdf" data-citation-page="1">Document p. 1</span>',
      ].join(" "),
      sourceDocuments: [{ documentId: "petition", documentName: "2026-03-18 Petition in Condemnation.pdf" }],
    });
    expect(markdown).toContain("Petition in Condemnation p. 1");
    expect(markdown).toContain("Source p. 1");
    expect(markdown).not.toContain("Other Matter Secret");
  });
  it("converts Markdown into editor HTML", () => {
    const html = markdownToEditorHtml([
      "# Chronology",
      "",
      "## Events",
      "",
      "### January 12, 2024",
      "",
      "A **bold** paragraph.",
      "",
      "> Quoted note.",
      "",
      "Source: Incident Report, p. 1.",
      "",
      "* First source",
      "* Second source",
      "",
      "1. First numbered item",
      "2. Second numbered item",
    ].join("\n"));

    expect(html).toContain("<h1>Chronology</h1>");
    expect(html).toContain("<h2>Events</h2>");
    expect(html).toContain("<h3>January 12, 2024</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('data-ml-citation="true"');
    expect(html).toContain('data-citation-label="Incident Report p. 1"');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>First source</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>First numbered item</li>");
  });

  it("converts editor HTML back into Markdown", () => {
    const markdown = editorHtmlToMarkdown([
      "<h1>Chronology</h1>",
      "<p>A <strong>bold</strong> paragraph.</p>",
      "<ul><li>First source</li><li>Second source</li></ul>",
    ].join(""));

    expect(markdown).toContain("# Chronology");
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("* First source");
    expect(markdown).toContain("* Second source");
  });

  it("preserves structured citation metadata across editor serialization", () => {
    const citation = citationMarkdown({
      citedText: "The initial offer was mailed on March 1.",
      locationLabel: "Offer summary",
      page: 2,
      paragraphNumber: 8,
      sourceDocumentId: "doc_offer",
      sourceDocumentName: "Initial Offer Letter.pdf",
      surroundingText: "The initial offer was mailed on March 1. The owner responded later.",
    });
    const html = markdownToEditorHtml(`The offer was sent ${citation}.`);
    const markdown = editorHtmlToMarkdown(html);

    expect(html).toContain('data-citation-source-document-id="doc_offer"');
    expect(html).toContain('data-citation-cited-text="The initial offer was mailed on March 1."');
    expect(html).toContain('data-citation-location-label="Offer summary"');
    expect(html).toContain('data-citation-paragraph-number="8"');
    expect(html).toContain('data-citation-label="Initial Offer Letter p. 2"');
    expect(markdown).toContain('data-citation-source-document-id="doc_offer"');
    expect(markdown).toContain('data-citation-surrounding-text="The initial offer was mailed on March 1. The owner responded later."');
    expect(markdown).toContain('data-citation-printable-text="(Initial Offer Letter, p. 2)"');
  });

  it("renders source document Markdown with visible page structure", () => {
    const html = sourceMarkdownToPreviewHtml([
      '<!-- ml:document {"documentId":"doc_1","fileName":"Report.pdf","type":"application/pdf"} -->',
      "",
      '<!-- ml:page {"page":1} -->',
      "",
      "First line",
      "Second line 22:14:08 BWC Camera activates. 22:14:21 ALVAREZ Go ahead.",
      "",
      '<!-- ml:page {"page":2} -->',
      "",
      "- Finding",
    ].join("\n"));

    expect(html).not.toContain("ml:document");
    expect(html).not.toContain("ml:page");
    expect(html).toContain("<h3>Page 1</h3>");
    expect(html).toContain("First line<br>");
    expect(html).toContain("Second line");
    expect(html).toContain("<p>22:14:08 BWC Camera activates.</p>");
    expect(html).toContain("<p>22:14:21 ALVAREZ Go ahead.</p>");
    expect(html).toContain("<h3>Page 2</h3>");
    expect(html).toContain("<li>Finding</li>");
  });

});

describe("document editor styling boundary", () => {
  it("uses semantic document styling instead of workflow-specific editor flags", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "workflow-steps/document-editor/component.tsx"),
      "utf8",
    );
    const globalCss = readFileSync(
      join(process.cwd(), "app/globals.css"),
      "utf8",
    );
    const citationExtensionSource = readFileSync(
      join(process.cwd(), "workflow-steps/document-editor/citation-extension.ts"),
      "utf8",
    );

    expect(componentSource).toContain("document-editor");
    expect(componentSource).toContain("document-editor-content");
    expect(componentSource).toContain("No source excerpt was captured for this citation.");
    expect(componentSource).not.toContain("|| citation.printableText?.trim()");
    expect(componentSource).not.toMatch(/is[A-Z][A-Za-z]+Editor/);
    expect(componentSource).not.toContain("ChronologyParagraph");
    expect(componentSource).not.toContain("chronology-editor");
    expect(globalCss).toContain(".ProseMirror.document-editor");
    expect(globalCss).toContain(".ProseMirror.document-editor h1");
    expect(globalCss).toContain(".ProseMirror.document-editor h2");
    expect(globalCss).toContain(".ProseMirror.document-editor ul");
    expect(globalCss).toContain(".ProseMirror.document-editor ol");
    expect(globalCss).toContain(".ProseMirror.document-editor blockquote");
    expect(componentSource).toContain("CitationNode");
    expect(globalCss).toContain(".document-citation-chip");
    expect(globalCss).toContain("text-overflow: ellipsis");
    expect(citationExtensionSource).toContain("title: label");
    expect(citationExtensionSource).toContain("buildCitationDisplayLabel");
    expect(globalCss).not.toContain(".ProseMirror.chronology-editor");
  });
});

describe("document editor DOCX export", () => {
  it("creates lawyer-friendly DOCX filenames", () => {
    expect(docxFileNameFromTitle("Chronology.md")).toBe("Chronology.docx");
    expect(docxFileNameFromTitle("Motion to Suppress")).toBe("Motion to Suppress.docx");
    expect(docxFileNameFromTitle("Bad/File:Name?.md")).toBe("Bad File Name.docx");
    expect(docxFileNameFromTitle("")).toBe("Matter Document.docx");
  });

  it("generates a DOCX blob from current TipTap content", async () => {
    const blob = await generateDocxBlobFromEditorJson({
      editorJson: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: {
              level: 1,
            },
            content: [
              {
                type: "text",
                text: "Chronology",
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Bold",
                marks: [
                  {
                    type: "bold",
                  },
                ],
              },
              {
                type: "text",
                text: " and italic",
                marks: [
                  {
                    type: "italic",
                  },
                ],
              },
              {
                type: "citation",
                attrs: {
                  label: "Initial Offer Letter p. 2",
                  page: 2,
                  printableText: "(Initial Offer Letter, p. 2)",
                  sourceDocumentId: "doc_offer",
                  sourceDocumentName: "Initial Offer Letter.pdf",
                },
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Bullet",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Numbered",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      title: "Chronology.md",
    });

    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("uses shared professional semantic styles and native numbering", async () => {
    const blob = await generateDocxBlobFromEditorJson({ editorJson: representativeWorkProductEditorJson, title: "Lawyer Memo" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file("word/styles.xml")!.async("string");
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const numbering = await zip.file("word/numbering.xml")!.async("string");

    expect(styles).toContain(`w:styleId="MatterLayerNormal"`);
    expect(styles).toContain(`<w:sz w:val="${DOCX_STYLES.paragraph.size}"`);
    expect(styles).toContain(`<w:spacing w:after="${DOCX_STYLES.paragraph.after}" w:line="${DOCX_STYLES.paragraph.line}"`);
    expect(styles).toContain(`w:styleId="MatterLayerTitle"`);
    expect(styles).toContain(`<w:sz w:val="${DOCX_STYLES.title.size}"`);
    expect(styles).toContain(`<w:keepNext/>`);
    expect(styles).toContain(`w:styleId="MatterLayerHeading1"`);
    expect(styles).toContain(`<w:spacing w:after="${DOCX_STYLES.heading1.after}" w:before="${DOCX_STYLES.heading1.before}"`);
    expect(documentXml).toContain(`<w:pgSz w:w="${DOCX_STYLES.page.width}" w:h="${DOCX_STYLES.page.height}"`);
    expect(documentXml).toContain(`<w:pgMar w:top="${DOCX_STYLES.page.margin}" w:right="${DOCX_STYLES.page.margin}" w:bottom="${DOCX_STYLES.page.margin}" w:left="${DOCX_STYLES.page.margin}"`);
    expect(documentXml).toContain(`<w:sz w:val="${DOCX_STYLES.citation.size}"`);
    expect(documentXml).toContain(`<w:t xml:space="preserve"> (Scheduling Notice, p. 1)</w:t>`);
    expect(documentXml).toContain(`<w:t xml:space="preserve"> (Initial Filing and Supporting Property Description`);
    expect(documentXml).toContain("<w:b/>");
    expect(documentXml).toContain("<w:i/>");
    expect(documentXml).toContain("<w:u");
    expect(documentXml).toContain("<w:hyperlink");
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
    expect(numbering).toContain('<w:numFmt w:val="decimal"/>');
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain('<w:tblW w:type="dxa" w:w="9360"/>');
    expect(documentXml).toContain('<w:vAlign w:val="top"/>');
    expect(documentXml).toContain("Total compensation");
    expect(documentXml).toContain(" (Condemnor Appraisal, p. 3)");

    function numberingIdFor(text: string) {
      const paragraph = documentXml.match(new RegExp(`<w:p(?:(?!</w:p>)[\\s\\S])*?<w:t[^>]*>${text}</w:t>(?:(?!</w:p>)[\\s\\S])*?</w:p>`))?.[0];
      return paragraph?.match(/<w:numId w:val="(\d+)"\/>/)?.[1];
    }
    const firstListId = numberingIdFor("Review the filed documents.");
    expect(numberingIdFor("Prepare for the hearing.")).toBe(firstListId);
    expect(numberingIdFor("This separate list restarts at one.")).not.toBe(firstListId);
  });

  it("preserves editable citation tables through HTML serialization", () => {
    const html = '<table><tbody><tr><th><p>Issue</p></th><th><p>Basis</p></th></tr><tr><td><p>Access</p></td><td><p>Plan <span data-ml-citation="true" data-citation-label="Plan p. 2" data-citation-printable-text="(Plan, p. 2)" data-citation-source-document-id="plan-1" data-citation-source-document-name="Plan.pdf" data-citation-page="2">Plan p. 2</span></p></td></tr></tbody></table>';
    const markdown = editorHtmlToMarkdown(html);
    expect(markdown).toContain("<table>");
    expect(markdown).toContain('data-citation-source-document-id="plan-1"');
  });

  it.each(["Lawyer Memo", "Client Summary", "Chronology"])("uses the same style system for %s", async (title) => {
    const blob = await generateDocxBlobFromEditorJson({ editorJson: representativeWorkProductEditorJson, title });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain('w:styleId="MatterLayerNormal"');
    expect(styles).toContain('w:styleId="MatterLayerTitle"');
  });
});
