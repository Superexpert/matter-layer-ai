export type ExtractionRepresentationDisplayState = {
  error: string | null;
  representationStatus: "Failed" | "Not started" | "Processing" | "Ready";
};

export type ExtractionRepresentationPersistenceStatus =
  | "FAILED"
  | "PENDING"
  | "PROCESSING"
  | "READY";

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
  status: ExtractionRepresentationPersistenceStatus | null | undefined,
  error: string | null | undefined,
): ExtractionRepresentationDisplayState {
  if (
    status === "FAILED" &&
    isObsoleteRepresentationInfrastructureError(error)
  ) {
    return {
      error: null,
      representationStatus: "Not started",
    };
  }

  if (status === "READY") {
    return {
      error: null,
      representationStatus: "Ready",
    };
  }

  if (status === "PROCESSING") {
    return {
      error: null,
      representationStatus: "Processing",
    };
  }

  if (status === "FAILED") {
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
