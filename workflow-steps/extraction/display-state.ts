import { MatterDocumentRepresentationStatus } from "@prisma/client";

export type ExtractionRepresentationDisplayState = {
  error: string | null;
  representationStatus: "Failed" | "Not started" | "Processing" | "Ready";
};

export function isObsoleteRepresentationInfrastructureError(
  error: string | null | undefined,
) {
  if (!error) {
    return false;
  }

  const isOldPdfWorkerError =
    error.includes("Setting up fake worker failed") &&
    error.includes("pdf.worker.mjs") &&
    error.includes("node_modules_pdfjs-dist");
  const isOldRuntimeRequireError = error.trim() === "require is not defined";

  return isOldPdfWorkerError || isOldRuntimeRequireError;
}

export function extractionRepresentationDisplayState(
  status: MatterDocumentRepresentationStatus | null | undefined,
  error: string | null | undefined,
): ExtractionRepresentationDisplayState {
  if (
    status === MatterDocumentRepresentationStatus.FAILED &&
    isObsoleteRepresentationInfrastructureError(error)
  ) {
    return {
      error: null,
      representationStatus: "Not started",
    };
  }

  if (status === MatterDocumentRepresentationStatus.READY) {
    return {
      error: null,
      representationStatus: "Ready",
    };
  }

  if (status === MatterDocumentRepresentationStatus.PROCESSING) {
    return {
      error: null,
      representationStatus: "Processing",
    };
  }

  if (status === MatterDocumentRepresentationStatus.FAILED) {
    return {
      error: error ?? null,
      representationStatus: "Failed",
    };
  }

  return {
    error: null,
    representationStatus: "Not started",
  };
}
