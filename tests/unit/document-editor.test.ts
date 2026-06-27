import { describe, expect, it } from "vitest";

import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
} from "../../workflow-steps/document-editor/conversion";
import {
  assertDocumentEditorStepOutput,
  normalizeDocumentEditorStepConfig,
} from "../../workflow-steps/document-editor/schema";

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
        sourceArtifactId: "artifact_1",
        status: "completed",
      }),
    ).toMatchObject({
      revisionId: "revision_1",
    });
    expect(
      assertDocumentEditorStepOutput({
        artifactId: "artifact_1",
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
      "* First source",
      "* Second source",
    ].join("\n"));

    expect(html).toContain("<h1>Chronology</h1>");
    expect(html).toContain("<strong>bold</strong>");
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
