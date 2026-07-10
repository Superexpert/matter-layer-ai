import { describe, expect, it } from "vitest";

import { runExtractionProfile } from "../../workflow-steps/extraction/profile-runner";
import { resolveExtractionDocumentMetadata } from "../../workflow-steps/extraction/document-metadata";
import { getExtractionProfile } from "../../workflow-steps/extraction/profiles";
import {
  EMINENT_DOMAIN_EVENT_TYPES,
  eminentDomainFactDefs,
  eminentDomainFactsProfile,
} from "../../workflow-steps/extraction/profiles/eminent-domain";

function response(facts: unknown[]) {
  return JSON.stringify({ facts });
}

async function extractFacts(input: {
  fileName?: string;
  facts: unknown[];
  markdown?: string;
  mimeType?: string;
}) {
  const fileName = input.fileName ?? "Fixture.txt";

  return runExtractionProfile(eminentDomainFactsProfile, {
    aiService: {
      generateText: async () => ({
        content: response(input.facts),
        model: "gpt-5-mini",
        provider: "fixture",
      }),
    },
    readyDocuments: [
      {
        fileName,
        id: "doc_fixture",
        markdown: input.markdown ?? "Fixture source text.",
        metadata: resolveExtractionDocumentMetadata({
          documentId: "doc_fixture",
          documentName: fileName,
          mimeType: input.mimeType ?? "text/plain",
        }),
      },
    ],
  });
}

describe("Eminent Domain extraction profile", () => {
  it("exposes exactly five broad active fact types", () => {
    expect(eminentDomainFactsProfile).toMatchObject({
      id: "eminent-domain-facts",
      label: "Eminent Domain Facts",
      taskId: "eminent-domain-facts",
    });
    expect(eminentDomainFactDefs.map((factDef) => factDef.factType)).toEqual([
      "MATTER_ENTITY",
      "PROPERTY_INTEREST",
      "VALUATION",
      "EVENT",
      "PROPERTY_IMPACT",
    ]);
    expect(JSON.stringify(eminentDomainFactsProfile.responseFormat?.schema))
      .not.toContain("DOCUMENT_REFERENCE");
    expect(JSON.stringify(eminentDomainFactsProfile.responseFormat?.schema))
      .not.toContain("PROPERTY_OWNER");
  });

  it("exports the facts profile and resolves the old id only through the registry alias", async () => {
    const moduleExports = await import("../../workflow-steps/extraction/profiles/eminent-domain");

    expect(moduleExports.eminentDomainFactsProfile).toBe(eminentDomainFactsProfile);
    expect("eminentDomainCaseAssessmentProfile" in moduleExports).toBe(false);
    expect(getExtractionProfile("eminent-domain-case-assessment")).toBe(
      eminentDomainFactsProfile,
    );
  });

  it("supports matter entities and removes invalid optional fields", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "MATTER_ENTITY",
          fields: {
            department: "Real Estate Division",
            entityType: "property-owner",
            name: "Ramirez Family Holdings, LLC",
            projectNumber: "SH-45-14",
          },
          sourceExcerpt: "Ramirez Family Holdings, LLC owns Parcel 14.",
        },
        {
          factType: "MATTER_ENTITY",
          fields: {
            department: "Transportation and Public Works",
            entityType: "condemning-authority",
            name: "City of Austin",
          },
          sourceExcerpt: "City of Austin Transportation and Public Works Department.",
        },
        {
          factType: "MATTER_ENTITY",
          fields: {
            entityType: "project",
            name: "East Braker Lane Expansion",
            projectNumber: "EBL-2026-14",
          },
          sourceExcerpt: "East Braker Lane Expansion Project No. EBL-2026-14.",
        },
      ],
    });

    expect(result).toMatchObject({
      itemCount: 3,
      status: "COMPLETED",
    });
    expect(result.items[0]?.fields).toEqual({
      entityType: "property-owner",
      name: "Ramirez Family Holdings, LLC",
    });
    expect(result.items[1]?.fields).toMatchObject({
      department: "Transportation and Public Works",
      entityType: "condemning-authority",
    });
    expect(result.items[2]?.fields).toMatchObject({
      entityType: "project",
      projectNumber: "EBL-2026-14",
    });
  });

  it("rejects placeholder entity names", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "MATTER_ENTITY",
          fields: {
            entityType: "property-owner",
            name: "Owner not named",
          },
          sourceExcerpt: "Owner not named.",
        },
      ],
    });

    expect(result).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });
  });

  it("supports subject property, fee-simple, and temporary construction easement interests", async () => {
    const prompt = eminentDomainFactsProfile.buildUserPrompt({
      documentId: "doc_property",
      fileName: "Property.txt",
      markdown: "Parcel 14 includes a fee acquisition and a TCE.",
      pageEnd: null,
      pageStart: null,
      windowIndex: 0,
    });

    expect(prompt).toContain("Area of the property or property interest represented by this fact");
    expect(prompt).toContain("Area of the remaining property after the acquisition");
    expect(prompt).toContain("Stated purpose of this specific acquired interest");

    const result = await extractFacts({
      facts: [
        {
          factType: "PROPERTY_INTEREST",
          fields: {
            address: "1428 East Braker Lane, Austin, Texas 78753",
            area: "5.60 acres",
            county: "Travis County",
            interestType: "subject-property",
            parcelNumber: "Parcel 14",
          },
          sourceExcerpt: "Parcel 14 contains 5.60 acres in Travis County.",
        },
        {
          factType: "PROPERTY_INTEREST",
          fields: {
            area: "0.84 acres",
            interestType: "fee-simple",
            parcelNumber: "Parcel 14",
            purpose: "Roadway widening and related public improvements.",
            takingScope: "partial",
          },
          sourceExcerpt: "0.84-acre fee-simple acquisition.",
        },
        {
          factType: "PROPERTY_INTEREST",
          fields: {
            area: "0.22 acres",
            interestType: "temporary-construction-easement",
            parcelNumber: "Parcel 14",
            purpose: "Grading, driveway reconstruction, utility coordination, staging, and construction access.",
          },
          sourceExcerpt: "0.22-acre temporary construction easement.",
        },
      ],
    });

    expect(result).toMatchObject({
      itemCount: 3,
      status: "COMPLETED",
    });
    expect(result.items.filter((fact) => fact.factType === "PROPERTY_INTEREST"))
      .toHaveLength(3);
  });

  it("rejects vague property-interest language", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "PROPERTY_INTEREST",
          fields: {
            interestType: "other",
            purpose: "disputed taking",
          },
          sourceExcerpt: "The disputed taking includes frontage.",
        },
      ],
    });

    expect(result).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });
    expect(result.error).toContain("too vague");
  });

  it("supports offers and appraisals as VALUATION facts", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$400,000",
            offerDate: "2026-01-12",
            parcelNumber: "Parcel 14",
            valuationType: "initial-offer",
          },
          sourceExcerpt: "initial written offer of $400,000",
        },
        {
          factType: "VALUATION",
          fields: {
            amount: "$435,000",
            offerDate: "2026-02-20",
            parcelNumber: "Parcel 14",
            responseDeadline: "2026-03-09",
            valuationType: "final-offer",
          },
          sourceExcerpt: "final written offer of $435,000",
        },
        {
          factType: "VALUATION",
          fields: {
            amount: "$425,000",
            appraiser: "Hill Country Valuation Group",
            costToCure: "$25,000",
            effectiveDate: "2026-02-01",
            parcelNumber: "Parcel 14",
            partTakenValue: "$300,000",
            remainderDamages: "$100,000",
            reportDate: "2026-02-05",
            temporaryDamages: "$25,000",
            valuationType: "condemnor-appraisal",
          },
          sourceExcerpt: "Hill Country Valuation Group valued compensation at $425,000.",
        },
        {
          factType: "VALUATION",
          fields: {
            amount: "$610,000",
            appraiser: "Riverbend Advisors",
            valuationType: "owner-appraisal",
          },
          sourceExcerpt: "Riverbend Advisors valued compensation at $610,000.",
        },
      ],
    });

    expect(result).toMatchObject({
      itemCount: 4,
      status: "COMPLETED",
    });
    expect(result.items[2]?.fields).toMatchObject({
      costToCure: "$25,000",
      partTakenValue: "$300,000",
      remainderDamages: "$100,000",
      valuationType: "condemnor-appraisal",
    });
  });

  it("removes invalid optional valuation fields and rejects valueless valuations", async () => {
    const cleaned = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$435,000",
            appraiser: "Should Be Removed",
            effectiveDate: "2026-02-01",
            offerDate: "2026-02-20",
            responseDeadline: "2026-03-09",
            valuationType: "final-offer",
          },
          sourceExcerpt: "final written offer of $435,000",
        },
      ],
    });

    expect(cleaned).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(cleaned.items[0]?.fields).toEqual({
      amount: "$435,000",
      offerDate: "2026-02-20",
      responseDeadline: "2026-03-09",
      valuationType: "final-offer",
    });

    const rejected = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            appraiser: "Future Appraiser",
            valuationType: "condemnor-appraisal",
          },
          sourceExcerpt: "An appraisal may be prepared later.",
        },
      ],
    });

    expect(rejected).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });

    const appraisal = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$425,000",
            offerDate: "2026-02-20",
            responseDeadline: "2026-03-09",
            valuationType: "condemnor-appraisal",
          },
          sourceExcerpt: "The condemnor appraisal states compensation of $425,000.",
        },
      ],
    });

    expect(appraisal).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(appraisal.items[0]?.fields).toEqual({
      amount: "$425,000",
      valuationType: "condemnor-appraisal",
    });
  });

  it("rejects old valuation date and offers without amounts", async () => {
    const oldDate = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$435,000",
            date: "2026-02-20",
            valuationType: "final-offer",
          },
          sourceExcerpt: "final written offer of $435,000",
        },
      ],
    });

    expect(oldDate).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });
    expect(oldDate.error).toContain("unsupported fields: date");

    for (const valuationType of ["initial-offer", "final-offer"]) {
      const missingAmount = await extractFacts({
        facts: [
          {
            factType: "VALUATION",
            fields: {
              offerDate: "2026-02-20",
              valuationType,
            },
            sourceExcerpt: "The City issued a written offer.",
          },
          {
            factType: "EVENT",
            fields: {
              description: "The City issued a written offer.",
              eventDate: "2026-02-20",
              eventType: valuationType === "final-offer"
                ? "final-offer-issued"
                : "initial-offer-issued",
            },
            sourceExcerpt: "The City issued a written offer.",
          },
        ],
      });

      expect(missingAmount).toMatchObject({
        itemCount: 1,
        status: "COMPLETED",
      });
      expect(missingAmount.items[0]?.factType).toBe("EVENT");
    }
  });

  it("documents and validates intentional valuation/event overlap", async () => {
    const prompt = eminentDomainFactsProfile.buildUserPrompt({
      documentId: "doc_offer",
      fileName: "Final Offer.txt",
      markdown: "The City issued its final written offer of $435,000 on February 20, 2026.",
      pageEnd: null,
      pageStart: null,
      windowIndex: 0,
    });

    expect(prompt).toContain("VALUATION captures the amount and valuation components");
    expect(prompt).toContain("EVENT captures the procedural timeline");

    const result = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$435,000",
            offerDate: "2026-02-20",
            valuationType: "final-offer",
          },
          sourceExcerpt: "final written offer of $435,000",
        },
        {
          factType: "EVENT",
          fields: {
            description: "The City issued its final written offer.",
            eventDate: "2026-02-20",
            eventType: "final-offer-issued",
          },
          sourceExcerpt: "issued its final written offer",
        },
      ],
    });

    expect(result).toMatchObject({
      itemCount: 2,
      status: "COMPLETED",
    });
    expect(result.items.map((fact) => fact.factType)).toEqual(["VALUATION", "EVENT"]);
  });

  it("uses the controlled EVENT enum", async () => {
    const valid = await extractFacts({
      facts: EMINENT_DOMAIN_EVENT_TYPES.map((eventType) => ({
        factType: "EVENT",
        fields: {
          description: `Source states ${eventType}.`,
          eventType,
        },
        sourceExcerpt: `Source states ${eventType}.`,
      })),
    });

    expect(valid).toMatchObject({
      itemCount: EMINENT_DOMAIN_EVENT_TYPES.length,
      status: "COMPLETED",
    });

    const invalid = await extractFacts({
      facts: [
        {
          factType: "EVENT",
          fields: {
            description: "A hearing happened.",
            eventType: "hearing",
          },
          sourceExcerpt: "A hearing happened.",
        },
      ],
    });

    expect(invalid).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });
  });

  it("supplements safe event dates from high-confidence document metadata", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "EVENT",
          fields: {
            description: "Owner called to report continued concerns about construction access near the west driveway.",
            eventType: "owner-response",
          },
          sourceExcerpt:
            "Owner called to report continued concerns about construction access near the west driveway.",
        },
      ],
      fileName: "2026-04-15 Owner Notes Access Concerns.txt",
      markdown:
        "Owner called to report continued concerns about construction access near the west driveway.",
    });

    expect(result).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(result.items[0]?.fields).toMatchObject({
      eventDate: "2026-04-15",
      eventType: "owner-response",
    });
    expect(result.items[0]?.evidence).toMatchObject({
      documentDate: "2026-04-15",
      documentDateSource: "filename",
    });
    expect(result.items[0]?.evidence.pageStart).toBeUndefined();
    expect(result.items[0]?.evidence.pageEnd).toBeUndefined();
  });

  it("preserves explicit body dates instead of overwriting them with document metadata", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "EVENT",
          fields: {
            description: "The City issued its final offer on February 20, 2026.",
            eventDate: "2026-02-20",
            eventType: "final-offer-issued",
          },
          sourceExcerpt: "The City issued its final offer on February 20, 2026.",
        },
      ],
      fileName: "2026-04-15 Owner Notes Access Concerns.txt",
      markdown: "The City issued its final offer on February 20, 2026.",
    });

    expect(result).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(result.items[0]?.fields).toMatchObject({
      eventDate: "2026-02-20",
      eventType: "final-offer-issued",
    });
  });

  it("supplements offerDate and appraisal reportDate without inferring effectiveDate", async () => {
    const offer = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$435,000",
            valuationType: "final-offer",
          },
          sourceExcerpt: "Final written offer of $435,000.",
        },
      ],
      fileName: "2026-02-20 Final Offer Letter - Parcel 14.pdf",
      markdown: "<!-- ml:page {\"page\":1} -->\nFinal written offer of $435,000.",
      mimeType: "application/pdf",
    });

    expect(offer).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(offer.items[0]?.fields).toMatchObject({
      amount: "$435,000",
      offerDate: "2026-02-20",
      valuationType: "final-offer",
    });
    expect(offer.items[0]?.evidence).toMatchObject({
      documentDate: "2026-02-20",
      documentDateSource: "filename",
      pageEnd: 1,
      pageStart: 1,
    });

    const appraisal = await extractFacts({
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$425,000",
            appraiser: "Hill Country Valuation Group",
            valuationType: "condemnor-appraisal",
          },
          sourceExcerpt: "Hill Country Valuation Group valued compensation at $425,000.",
        },
      ],
      fileName: "2026-02-05 Condemnor Appraisal Summary.pdf",
      markdown:
        "<!-- ml:page {\"page\":2} -->\nHill Country Valuation Group valued compensation at $425,000.",
      mimeType: "application/pdf",
    });

    expect(appraisal).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(appraisal.items[0]?.fields).toMatchObject({
      amount: "$425,000",
      reportDate: "2026-02-05",
      valuationType: "condemnor-appraisal",
    });
    expect(appraisal.items[0]?.fields.effectiveDate).toBeUndefined();
  });

  it("does not add synthetic dates to property impacts", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "PROPERTY_IMPACT",
          fields: {
            category: "access",
            description: "The appraisal assumes that one commercially reasonable driveway will remain.",
            sourceRole: "appraiser",
          },
          sourceExcerpt:
            "The appraisal assumes that one commercially reasonable driveway will remain.",
        },
      ],
      fileName: "2026-02-05 Condemnor Appraisal Summary.txt",
      markdown: "The appraisal assumes that one commercially reasonable driveway will remain.",
    });

    expect(result).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(result.items[0]?.fields).not.toHaveProperty("eventDate");
    expect(result.items[0]?.fields).not.toHaveProperty("offerDate");
    expect(result.items[0]?.fields).not.toHaveProperty("reportDate");
  });

  it("rejects follow-up instructions as PROPERTY_IMPACT facts", async () => {
    const prompt = eminentDomainFactsProfile.buildUserPrompt({
      documentId: "doc_impact",
      fileName: "Impacts.txt",
      markdown: "Confirm whether the appraisal accounts for parking loss.",
      pageEnd: null,
      pageStart: null,
      windowIndex: 0,
    });

    expect(prompt).not.toContain("valuation-related");
    expect(prompt).toContain("Do not extract abstract appraisal deficiencies");

    const result = await extractFacts({
      facts: [
        {
          factType: "PROPERTY_IMPACT",
          fields: {
            category: "parking",
            description: "Confirm whether the appraisal accounts for parking loss.",
          },
          sourceExcerpt: "Confirm whether the appraisal accounts for parking loss.",
        },
      ],
    });

    expect(result).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });

    const assumption = await extractFacts({
      facts: [
        {
          factType: "PROPERTY_IMPACT",
          fields: {
            affectedFeature: "remaining driveway access",
            assertionStatus: "assumed",
            category: "access",
            description: "The appraisal assumes that one commercially reasonable driveway will remain.",
            sourceRole: "appraiser",
          },
          sourceExcerpt: "The appraisal assumes that one commercially reasonable driveway will remain.",
        },
      ],
    });

    expect(assumption).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
  });

  it("extracts the paralegal intake summary as property and impact facts only", async () => {
    const result = await extractFacts({
      facts: [
        {
          factType: "PROPERTY_INTEREST",
          fields: {
            interestType: "subject-property",
            parcelNumber: "Parcel 14",
          },
          sourceExcerpt: "Parcel 14 eminent-domain matter.",
        },
        {
          factType: "PROPERTY_IMPACT",
          fields: {
            affectedFeature: "customer parking",
            assertionStatus: "alleged",
            category: "parking",
            description: "The intake identifies potential impairment of customer parking from the frontage taking.",
            parcelNumber: "Parcel 14",
            sourceRole: "intake",
          },
          sourceExcerpt: "frontage area used for customer parking",
        },
        {
          factType: "PROPERTY_IMPACT",
          fields: {
            affectedFeature: "signage visibility",
            assertionStatus: "alleged",
            category: "signage",
            description: "The intake identifies potential impairment of signage visibility from the frontage taking.",
            parcelNumber: "Parcel 14",
            sourceRole: "intake",
          },
          sourceExcerpt: "signage visibility",
        },
        {
          factType: "PROPERTY_IMPACT",
          fields: {
            affectedFeature: "delivery access",
            assertionStatus: "alleged",
            category: "access",
            description: "The intake identifies potential impairment of delivery access from the frontage taking.",
            parcelNumber: "Parcel 14",
            sourceRole: "intake",
          },
          sourceExcerpt: "delivery access",
        },
        {
          factType: "PROPERTY_IMPACT",
          fields: {
            category: "parking",
            description: "Request backup for the condemnor's traffic-control plan.",
          },
          sourceExcerpt: "Request backup for the condemnor's traffic-control plan.",
        },
      ],
      markdown: [
        "Paralegal intake summary for Parcel 14 eminent-domain matter.",
        "The disputed taking includes frontage area used for customer parking, signage visibility, and delivery access.",
        "Confirm whether the appraisal accounts for parking loss.",
        "Request backup for the condemnor's traffic-control plan.",
        "Collect photos of current driveway usage.",
      ].join("\n"),
    });

    expect(result).toMatchObject({
      itemCount: 4,
      status: "COMPLETED",
    });
    expect(result.items.map((fact) => fact.factType)).toEqual([
      "PROPERTY_INTEREST",
      "PROPERTY_IMPACT",
      "PROPERTY_IMPACT",
      "PROPERTY_IMPACT",
    ]);
    expect(result.items.some((fact) => fact.factType === "DOCUMENT_REFERENCE")).toBe(false);
  });

  it("makes one AI call per markdown window and preserves PDF page provenance", async () => {
    let callCount = 0;
    const result = await runExtractionProfile(eminentDomainFactsProfile, {
      aiService: {
        generateText: async () => {
          callCount += 1;

          return {
            content: response([
              {
                factType: "MATTER_ENTITY",
                fields: {
                  entityType: "property-owner",
                  name: "Ramirez Family Holdings, LLC",
                },
                sourceExcerpt: "Ramirez Family Holdings, LLC owns Parcel 14.",
              },
            ]),
            model: "gpt-5-mini",
            provider: "fixture",
          };
        },
      },
      readyDocuments: [
        {
          fileName: "Owner.pdf",
          id: "doc_pdf",
          markdown: '<!-- ml:page {"page":3} -->\nRamirez Family Holdings, LLC owns Parcel 14.',
        },
      ],
    });

    expect(callCount).toBe(1);
    expect(result).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(result.items[0]?.evidence).toMatchObject({
      pageEnd: 3,
      pageStart: 3,
    });
  });
});
