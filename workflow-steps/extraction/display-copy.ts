import type { ExtractionStepOutput } from "./schema";

export function summaryForOutput(output: ExtractionStepOutput | null) {
  if (!output) {
    return "Selected documents have not been prepared yet.";
  }

  if (output.status === "completed") {
    const artifactCount = Object.values(output.artifactReferences).filter(Boolean).length;

    return `Extracted ${output.extractedFactCount} item${output.extractedFactCount === 1 ? "" : "s"} from ${output.readyRepresentationCount} document${output.readyRepresentationCount === 1 ? "" : "s"}${artifactCount > 0 ? ` and generated ${artifactCount} artifact${artifactCount === 1 ? "" : "s"}` : ""}.`;
  }

  if (output.status === "running") {
    return "Preparing selected documents...";
  }

  if (output.status === "partial_failed") {
    if (output.error?.documentErrors?.length) {
      return output.error.userMessage;
    }

    return output.error?.userMessage ??
      `Partial extraction: ${output.extractedFactCount} item${output.extractedFactCount === 1 ? "" : "s"} extracted; ${output.failedRepresentationCount} document${output.failedRepresentationCount === 1 ? "" : "s"} or window(s) could not be processed.`;
  }

  return output.error?.userMessage ??
    "Matter Layer could not prepare the selected documents.";
}

export function headingForOutputError(output: ExtractionStepOutput | null) {
  if (output?.status === "partial_failed") {
    return "Some documents could not be prepared";
  }

  return "Preparation failed";
}
