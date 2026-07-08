import { describe, expect, it } from "vitest";

import { isFileSelectorDocumentSelectable } from "../../workflow-steps/file-selector/component";

describe("file selector component behavior", () => {
  it("treats only currently selectable documents as bulk-selectable", () => {
    expect(
      isFileSelectorDocumentSelectable({
        allowExistingMatterFiles: true,
        documentId: "existing-document",
        uploadedDuringStepMatterDocumentIds: [],
      }),
    ).toBe(true);

    expect(
      isFileSelectorDocumentSelectable({
        allowExistingMatterFiles: false,
        documentId: "existing-document",
        uploadedDuringStepMatterDocumentIds: ["uploaded-document"],
      }),
    ).toBe(false);

    expect(
      isFileSelectorDocumentSelectable({
        allowExistingMatterFiles: false,
        documentId: "uploaded-document",
        uploadedDuringStepMatterDocumentIds: ["uploaded-document"],
      }),
    ).toBe(true);
  });
});
