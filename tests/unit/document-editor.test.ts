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
  docxFileNameFromTitle,
  generateDocxBlobFromEditorJson,
} from "../../workflow-steps/document-editor/docx-export";
import { citationMarkdown } from "../../workflow-steps/document-editor/citations";

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
});
