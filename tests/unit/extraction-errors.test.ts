import { describe, expect, it } from "vitest";

import { summaryForOutput } from "../../workflow-steps/extraction/display-copy";
import {
  documentRepresentationError,
  extractionProviderError,
  extractionStepErrorForDocuments,
  suggestedActionForError,
} from "../../workflow-steps/extraction/errors";
import type { ExtractionStepOutput } from "../../workflow-steps/extraction/schema";

function outputWith(input: Partial<ExtractionStepOutput>): ExtractionStepOutput {
  return {
    chronologyArtifactId: null,
    collapsedEventCount: 0,
    collapsedEvents: [],
    error: null,
    extractedFactCount: 0,
    extractionRunId: "run_123",
    extractionWindowCount: 0,
    facts: [],
    factsByType: {},
    failedDocumentIds: [],
    failedRepresentationCount: 0,
    preparedDocumentIds: [],
    profile: "chronology",
    readyRepresentationCount: 0,
    schemaVersion: 1,
    selectedMatterDocumentIds: [],
    status: "failed",
    ...input,
  };
}

describe("extraction step errors", () => {
  it("builds document-level representation errors with safe user messages", () => {
    const documentError = documentRepresentationError({
      error: "No ready Markdown representation was available.",
      fileName: "01_Incident_Report_Officer_Alvarez_v2.pdf",
      matterDocumentId: "doc_123",
      mimeType: "application/pdf",
    });

    expect(documentError).toMatchObject({
      code: "DOCUMENT_REPRESENTATION_MISSING",
      fileName: "01_Incident_Report_Officer_Alvarez_v2.pdf",
      matterDocumentId: "doc_123",
      userMessage: "No AI-readable version was available for this PDF.",
    });
  });

  it("creates a structured failed output message for document preparation failures", () => {
    const documentError = documentRepresentationError({
      error: "Unsupported file type: image/png",
      fileName: "photo.png",
      matterDocumentId: "doc_456",
      mimeType: "image/png",
    });
    const error = extractionStepErrorForDocuments({
      documentErrors: [documentError],
      partial: false,
    });

    const output = outputWith({
      error,
      failedDocumentIds: ["doc_456"],
      selectedMatterDocumentIds: ["doc_456"],
    });

    expect(output.error).toMatchObject({
      code: "UNSUPPORTED_FILE_TYPE",
      documentErrors: [
        {
          fileName: "photo.png",
          userMessage:
            "This file type is not supported yet. Try uploading a PDF, DOCX, TXT, or Markdown file.",
        },
      ],
    });
    expect(summaryForOutput(output)).toBe(
      "Matter Layer could not prepare the selected documents because one or more files could not be converted into AI-readable Markdown.",
    );
    expect(suggestedActionForError(output.error)).toBe(
      "This file type is not supported yet. Try uploading a PDF, DOCX, TXT, or Markdown file.",
    );
  });

  it("describes partial document preparation failures without hiding document errors", () => {
    const error = extractionStepErrorForDocuments({
      documentErrors: [
        documentRepresentationError({
          error: "No ready Markdown representation was available.",
          fileName: "report.pdf",
          matterDocumentId: "doc_failed",
          mimeType: "application/pdf",
        }),
      ],
      partial: true,
    });

    const output = outputWith({
      error,
      failedDocumentIds: ["doc_failed"],
      failedRepresentationCount: 1,
      preparedDocumentIds: ["doc_ready"],
      readyRepresentationCount: 1,
      selectedMatterDocumentIds: ["doc_ready", "doc_failed"],
      status: "partial_failed",
    });

    expect(output.error).toMatchObject({
      code: "PARTIAL_DOCUMENT_PREPARATION_FAILED",
      documentErrors: [
        {
          matterDocumentId: "doc_failed",
          userMessage: "No AI-readable version was available for this PDF.",
        },
      ],
      userMessage:
        "Some selected documents were prepared, but one or more files could not be converted into AI-readable Markdown.",
    });
    expect(summaryForOutput(output)).toBe("Some documents could not be prepared.");
  });

  it("does not expose raw provider errors as user-facing text", () => {
    const rawError =
      "Window 1 failed\n    at runExtraction (/workspace/internal/service.ts:42:9)";
    const error = extractionProviderError(rawError);
    const output = outputWith({
      error,
      status: "failed",
    });

    expect(error.message).toBe(rawError);
    expect(error.userMessage).not.toContain("service.ts");
    expect(error.userMessage).not.toContain(" at ");
    expect(summaryForOutput(output)).toBe(error.userMessage);
  });

  it("shows a running message for persisted autorun output", () => {
    expect(
      summaryForOutput(
        outputWith({
          status: "running",
        }),
      ),
    ).toBe("Preparing selected documents...");
  });

  it("falls back to a safe suggested action for unknown error codes", () => {
    expect(
      suggestedActionForError({
        code: "SOMETHING_NEW",
        message: "Internal details",
        userMessage: "A safe message.",
      }),
    ).toBe(
      "Try running the preparation step again. If the problem continues, check the server logs for details.",
    );
  });
});
