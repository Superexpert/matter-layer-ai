import { MatterDocumentRepresentationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  extractionRepresentationDisplayState,
  isObsoleteRepresentationInfrastructureError,
} from "../../workflow-steps/extraction/display-state";

const stalePdfWorkerError =
  'Setting up fake worker failed: "Cannot find module \'/Users/stephenwalther/GitRepos/matter-layer-ai/matter-layer-ai/.next/dev/server/chunks/ssr/pdf.worker.mjs\' imported from /Users/stephenwalther/GitRepos/matter-layer-ai/matter-layer-ai/.next/dev/server/chunks/ssr/node_modules_pdfjs-dist_legacy_build_pdf_mjs_1p6i-7y._.js".';

describe("extraction representation display state", () => {
  it("treats stale pdfjs worker failures as not started", () => {
    expect(isObsoleteRepresentationInfrastructureError(stalePdfWorkerError)).toBe(
      true,
    );
    expect(
      extractionRepresentationDisplayState(
        MatterDocumentRepresentationStatus.FAILED,
        stalePdfWorkerError,
      ),
    ).toEqual({
      error: null,
      representationStatus: "Not started",
    });
  });

  it("treats stale runtime require failures as not started", () => {
    expect(
      extractionRepresentationDisplayState(
        MatterDocumentRepresentationStatus.FAILED,
        "require is not defined",
      ),
    ).toEqual({
      error: null,
      representationStatus: "Not started",
    });
  });

  it("keeps current conversion failures visible", () => {
    expect(
      extractionRepresentationDisplayState(
        MatterDocumentRepresentationStatus.FAILED,
        "No extractable text was found in this PDF. OCR is not implemented yet.",
      ),
    ).toEqual({
      error: "No extractable text was found in this PDF. OCR is not implemented yet.",
      representationStatus: "Failed",
    });
  });

  it("maps normal representation statuses", () => {
    expect(
      extractionRepresentationDisplayState(
        MatterDocumentRepresentationStatus.READY,
        null,
      ),
    ).toEqual({
      error: null,
      representationStatus: "Ready",
    });
    expect(
      extractionRepresentationDisplayState(
        MatterDocumentRepresentationStatus.PROCESSING,
        null,
      ),
    ).toEqual({
      error: null,
      representationStatus: "Processing",
    });
    expect(extractionRepresentationDisplayState(null, null)).toEqual({
      error: null,
      representationStatus: "Not started",
    });
  });
});
