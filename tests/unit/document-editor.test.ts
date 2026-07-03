import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
} from "../../workflow-steps/document-editor/conversion";
import {
  assertDocumentEditorStepOutput,
  normalizeDocumentEditorStepConfig,
} from "../../workflow-steps/document-editor/schema";
import {
  docxFileNameFromTitle,
  generateDocxBlobFromEditorJson,
} from "../../workflow-steps/document-editor/docx-export";

describe("document editor schema", () => {
  it("accepts valid config and applies defaults", () => {
    expect(
      normalizeDocumentEditorStepConfig({
        artifactOutputKey: "chronologyArtifactId",
        inputStepId: "extract-chronology",
      }),
    ).toEqual({
      artifactOutputKey: "chronologyArtifactId",
      contentType: "MARKDOWN",
      documentFileName: null,
      documentTitle: null,
      editor: "tiptap",
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
      "A **bold** paragraph.",
      "",
      "Source: Incident Report, p. 1.",
      "",
      "* First source",
      "* Second source",
    ].join("\n"));

    expect(html).toContain("<h1>Chronology</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain(
      '<p class="document-citation" data-node-type="citation">Source: Incident Report, p. 1.</p>',
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>First source</li>");
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
    expect(componentSource).not.toMatch(/is[A-Z][A-Za-z]+Editor/);
    expect(componentSource).not.toContain("ChronologyParagraph");
    expect(componentSource).not.toContain("chronology-editor");
    expect(globalCss).toContain(".ProseMirror.document-editor");
    expect(globalCss).toContain('[data-node-type="citation"]');
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
