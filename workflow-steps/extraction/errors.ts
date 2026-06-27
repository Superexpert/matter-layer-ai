import type {
  WorkflowStepDocumentError,
  WorkflowStepError,
} from "@/services/workflows/workflow-step-errors";

export const EXTRACTION_ERROR_ACTIONS: Record<string, string> = {
  DOCUMENT_ACCESS_DENIED:
    "Go back to Select source documents and choose documents from this matter.",
  DOCUMENT_NOT_FOUND:
    "Go back to Select source documents and choose the file again.",
  DOCUMENT_PREPARATION_FAILED:
    "Try running preparation again. If the problem continues, re-upload the affected files.",
  DOCUMENT_REPRESENTATION_MISSING:
    "Try re-uploading the document or regenerating document representations from the Documents tab.",
  EXTRACTION_PROVIDER_FAILED:
    "Try running preparation again. If the problem continues, check the configured AI provider.",
  INTERNAL_ERROR:
    "Try running the preparation step again. If the problem continues, check the server logs for details.",
  PARTIAL_DOCUMENT_PREPARATION_FAILED:
    "Review the files listed below. You can retry preparation or return to Select source documents.",
  UNSUPPORTED_FILE_TYPE:
    "This file type is not supported yet. Try uploading a PDF, DOCX, TXT, or Markdown file.",
};

export function suggestedActionForError(error: WorkflowStepError | null | undefined) {
  if (!error) {
    return null;
  }

  return EXTRACTION_ERROR_ACTIONS[error.code] ?? EXTRACTION_ERROR_ACTIONS.INTERNAL_ERROR;
}

export function safeUnknownExtractionError(error: unknown): WorkflowStepError {
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Unknown extraction preparation error.",
    userMessage:
      "Matter Layer could not prepare the selected documents because an internal error occurred.",
  };
}

export function documentRepresentationError(input: {
  error: string | null;
  fileName?: string;
  matterDocumentId: string;
  mimeType?: string;
}): WorkflowStepDocumentError {
  const message = input.error?.trim() || "No ready Markdown representation was available.";
  let code = "DOCUMENT_PREPARATION_FAILED";
  let userMessage = "This document could not be converted into AI-readable Markdown.";

  if (message.includes("Unsupported file type")) {
    code = "UNSUPPORTED_FILE_TYPE";
    userMessage =
      "This file type is not supported yet. Try uploading a PDF, DOCX, TXT, or Markdown file.";
  } else if (
    message.includes("No ready Markdown representation") ||
    message.includes("No selected documents could be prepared")
  ) {
    code = "DOCUMENT_REPRESENTATION_MISSING";
    userMessage = input.mimeType === "application/pdf"
      ? "No AI-readable version was available for this PDF."
      : "No AI-readable version was available for this document.";
  } else if (message.includes("OCR is not implemented")) {
    code = "DOCUMENT_PREPARATION_FAILED";
    userMessage =
      "This PDF appears to require OCR, which is not implemented yet.";
  }

  return {
    code,
    fileName: input.fileName,
    matterDocumentId: input.matterDocumentId,
    message,
    userMessage,
  };
}

export function extractionStepErrorForDocuments(input: {
  documentErrors: WorkflowStepDocumentError[];
  partial: boolean;
}): WorkflowStepError | null {
  if (input.documentErrors.length === 0) {
    return null;
  }

  if (input.partial) {
    return {
      code: "PARTIAL_DOCUMENT_PREPARATION_FAILED",
      documentErrors: input.documentErrors,
      message: "Some selected documents could not be prepared.",
      userMessage:
        "Some selected documents were prepared, but one or more files could not be converted into AI-readable Markdown.",
    };
  }

  const firstCode = input.documentErrors[0]?.code ?? "DOCUMENT_PREPARATION_FAILED";
  const commonCode = input.documentErrors.every((error) => error.code === firstCode)
    ? firstCode
    : "DOCUMENT_PREPARATION_FAILED";

  return {
    code: commonCode,
    documentErrors: input.documentErrors,
    message: "One or more selected documents could not be prepared.",
    userMessage:
      "Matter Layer could not prepare the selected documents because one or more files could not be converted into AI-readable Markdown.",
  };
}

export function extractionProviderError(message: string): WorkflowStepError {
  return {
    code: "EXTRACTION_PROVIDER_FAILED",
    message,
    userMessage:
      "Matter Layer prepared the documents, but the chronology extraction provider could not process one or more document windows.",
  };
}
