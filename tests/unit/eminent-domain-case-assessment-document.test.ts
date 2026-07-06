import { describe, expect, it } from "vitest";

import {
  NO_INFORMATION,
  composeEminentDomainCaseAssessment,
} from "../../workflow-steps/extraction/profiles/eminent-domain/case-assessment-document";
import type { EminentDomainAssessmentItem } from "../../workflow-steps/extraction/profiles/eminent-domain/schema";

const assessmentItem: EminentDomainAssessmentItem = {
  assessment: {
    matterOverview: {
      condemningAuthority: "Central Texas Mobility Authority",
      county: "Travis County",
      projectName: "FM 812 Expansion",
      propertyOwner: "Parcel 14 owner",
    },
    missingDocuments: ["Owner appraisal has not been provided."],
    proceduralFlags: [
      {
        explanation:
          "The hearing notice sets a special commissioners hearing date.",
        issue: "Special commissioners hearing scheduled",
        severity: "high",
        sourceCitation: "Notice at 1",
      },
    ],
    recommendedNextActions: ["Request backup for the traffic-control plan."],
    takingSummary: {
      estateTaken: "temporary construction easement",
      keyConcerns: ["Driveway access and customer parking may be affected"],
      projectPurpose: "roadway expansion",
      typeOfTaking: "partial taking",
    },
    timeline: [
      {
        confidence: "high",
        date: "2026-04-08",
        event: "Special commissioners hearing notice was issued",
        sourceCitation: "Notice at 1",
      },
    ],
    valuationSummary: {
      finalOffer: "$125,000",
      initialOffer: "$100,000",
      remainderDamages: "Parking loss may affect remainder value",
      valuationGaps: ["No owner appraisal in selected documents"],
    },
  },
  sourceDocumentId: "doc_notice",
  sourceFileName: "2026-04-08 Special Commissioners Hearing Notice.pdf",
};

describe("Eminent Domain Case Assessment composer", () => {
  it("generates the required editable assessment sections from extraction output", () => {
    const markdown = composeEminentDomainCaseAssessment([assessmentItem]);

    expect(markdown).toContain("# Eminent Domain Case Assessment");
    expect(markdown).toContain("## Case Overview");
    expect(markdown).toContain("## Key Dates and Procedural Timeline");
    expect(markdown).toContain("## Property and Parcel Information");
    expect(markdown).toContain("## Offer History");
    expect(markdown).toContain("## Appraisal and Valuation Issues");
    expect(markdown).toContain("## Access, Parking, and Remainder-Damage Issues");
    expect(markdown).toContain("## Procedural / Statutory Flags");
    expect(markdown).toContain("## Missing Documents or Information");
    expect(markdown).toContain("## Recommended Next Actions");
    expect(markdown).toContain("## Source Notes");
    expect(markdown).toContain("Central Texas Mobility Authority");
    expect(markdown).toContain("$125,000");
    expect(markdown).toContain("2026-04-08 Special Commissioners Hearing Notice.pdf: Notice at 1");
    expect(markdown).not.toContain('"matterOverview"');
  });

  it("renders graceful empty notes when no facts were extracted", () => {
    const markdown = composeEminentDomainCaseAssessment([]);

    expect(markdown).toContain("# Eminent Domain Case Assessment");
    expect(markdown.match(new RegExp(NO_INFORMATION, "g"))?.length).toBeGreaterThan(5);
  });
});
