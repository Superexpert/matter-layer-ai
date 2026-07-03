import { describe, expect, it } from "vitest";

import { getMatterDocumentDisplayName } from "../../services/matter-documents/display-name";

describe("matter document display names", () => {
  it("removes a trailing Markdown extension from work product names", () => {
    expect(
      getMatterDocumentDisplayName({
        documentSection: "workProduct",
        fileName: "Chronology.md",
      }),
    ).toBe("Chronology");
    expect(
      getMatterDocumentDisplayName({
        documentSection: "workProduct",
        fileName: "Motion to Suppress.md",
      }),
    ).toBe("Motion to Suppress");
    expect(
      getMatterDocumentDisplayName({
        documentSection: "workProduct",
        fileName: "Client Intake Summary.MD",
      }),
    ).toBe("Client Intake Summary");
  });

  it("leaves source document filenames unchanged", () => {
    expect(
      getMatterDocumentDisplayName({
        documentSection: "sourceDocument",
        fileName: "01_Incident_Report_Officer_Alvarez_V2.pdf",
      }),
    ).toBe("01_Incident_Report_Officer_Alvarez_V2.pdf");
  });

  it("does not mutate the stored filename value", () => {
    const document = {
      documentSection: "workProduct" as const,
      fileName: "Chronology.md",
    };

    expect(getMatterDocumentDisplayName(document)).toBe("Chronology");
    expect(document.fileName).toBe("Chronology.md");
  });
});
