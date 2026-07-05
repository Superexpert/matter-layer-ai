import { describe, expect, it } from "vitest";

import { summaryForOutput } from "../../workflow-steps/extraction/display-copy";
import {
  documentRepresentationError,
  EXTRACTION_DOCUMENT_PROVIDER_USER_MESSAGE,
  INVALID_JSON_PROVIDER_USER_MESSAGE,
  extractionProviderError,
  extractionStepErrorForDocuments,
  suggestedActionForError,
} from "../../workflow-steps/extraction/errors";
import type { ExtractionStepOutput } from "../../workflow-steps/extraction/schema";

function outputWith(input: Partial<ExtractionStepOutput>): ExtractionStepOutput {
  return {
    artifactReferences: {},
    collapsedEventCount: 0,
    collapsedEvents: [],
    documentResults: [],
    error: null,
    extractedFactCount: 0,
    extractionRunId: "run_123",
    extractionWarnings: [],
    extractionWindowCount: 0,
    facts: [],
    factsByType: {},
    failedDocumentIds: [],
    failedRepresentationCount: 0,
    preparedDocumentIds: [],
    outputKey: null,
    profile: "chronology",
    profileOutput: null,
    progress: null,
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
    expect(summaryForOutput(output)).toBe(
      "Some selected documents were prepared, but one or more files could not be converted into AI-readable Markdown.",
    );
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

  it("maps invalid JSON provider output to a safe user-facing message", () => {
    const rawError =
      "Window 1 for 02_Supplemental_Report_Officer_Benton.pdf: Extraction response must be valid JSON.";
    const error = extractionStepErrorForDocuments({
      documentErrors: [
        {
          code: "EXTRACTION_PROVIDER_FAILED",
          fileName: "02_Supplemental_Report_Officer_Benton.pdf",
          matterDocumentId: "doc_json_failed",
          message: rawError,
          userMessage: EXTRACTION_DOCUMENT_PROVIDER_USER_MESSAGE,
        },
      ],
      partial: true,
    });
    const output = outputWith({
      error,
      failedDocumentIds: ["doc_json_failed"],
      preparedDocumentIds: ["doc_ready"],
      status: "partial_failed",
    });

    expect(error?.documentErrors?.[0]?.message).toBe(rawError);
    expect(error?.documentErrors?.[0]?.userMessage).toBe(
      "Matter Layer could not extract facts from this document.",
    );
    expect(error?.userMessage).toBe(INVALID_JSON_PROVIDER_USER_MESSAGE);
    expect(error?.userMessage).not.toContain("Window 1");
    expect(error?.userMessage).not.toContain("valid JSON");
    expect(summaryForOutput(output)).toBe(INVALID_JSON_PROVIDER_USER_MESSAGE);
  });

  it("preserves invalid JSON diagnostics on provider errors while using safe display text", () => {
    const rawError = "Extraction response must be valid JSON.";
    const error = extractionProviderError(rawError);

    expect(error.message).toBe(rawError);
    expect(error.userMessage).toBe(INVALID_JSON_PROVIDER_USER_MESSAGE);
  });

  it("surfaces classified AI provider errors with safe user-facing text", () => {
    const error = extractionStepErrorForDocuments({
      documentErrors: [
        {
          code: "AI_PROVIDER_BILLING_REQUIRED",
          fileName: "report.pdf",
          matterDocumentId: "doc_ai_failed",
          message: "Window 1 for report.pdf: insufficient_quota",
          userMessage:
            "The configured AI provider account appears to need billing, credits, or quota attention before Matter Layer can continue.",
        },
      ],
      partial: false,
    });
    const output = outputWith({
      error,
      failedDocumentIds: ["doc_ai_failed"],
      status: "failed",
    });

    expect(error).toMatchObject({
      code: "AI_PROVIDER_BILLING_REQUIRED",
      userMessage:
        "The configured AI provider account appears to need billing, credits, or quota attention before Matter Layer can continue.",
    });
    expect(summaryForOutput(output)).toBe(error?.userMessage);
    expect(suggestedActionForError(error)).toContain("billing");
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
