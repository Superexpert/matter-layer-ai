import { describe, expect, it } from "vitest";

import { collapseExtractedFacts } from "../../workflow-steps/extraction/identity";
import { normalizeFieldValue } from "../../workflow-steps/extraction/identity/normalizers";
import {
  eminentDomainFactDefs,
  eminentDomainFactsProfile,
} from "../../workflow-steps/extraction/profiles/eminent-domain";
import type { ExtractedFact } from "../../workflow-steps/extraction/extracted-fact";
import type { FactDef } from "../../workflow-steps/extraction/fact-def";

const genericFactDefs = [
  {
    extraction: {
      fields: [
        { name: "name", normalizer: "organization-name", required: true, type: "string" },
        { name: "amount", normalizer: "currency", required: false, type: "string" },
      ],
      instructions: "Extract organizations.",
    },
    factType: "ORG",
    identity: {
      rules: [
        {
          action: "merge",
          fields: ["name"],
        },
      ],
      strategy: "multiKey",
    },
  },
  {
    extraction: {
      fields: [
        { name: "name", normalizer: "organization-name", required: true, type: "string" },
      ],
      instructions: "Extract uncategorized organizations.",
    },
    factType: "NO_IDENTITY",
  },
  {
    extraction: {
      fields: [
        { name: "kind", normalizer: "lowercase", required: true, type: "string" },
        { name: "name", normalizer: "lowercase", required: true, type: "string" },
        { name: "externalId", normalizer: "lowercase", required: false, type: "string" },
      ],
      instructions: "Extract keyed facts.",
    },
    factType: "UNIQUE",
    identity: {
      rules: [
        {
          action: "mergeWhenUnique",
          fields: ["kind", "name"],
          uniqueAgainst: ["externalId"],
        },
      ],
      strategy: "multiKey",
    },
  },
] satisfies FactDef[];

function fact(input: {
  documentId?: string;
  excerpt?: string;
  factType: string;
  fields: Record<string, unknown>;
  id: string;
}): ExtractedFact {
  return {
    evidence: {
      documentId: input.documentId ?? `doc_${input.id}`,
      documentName: `${input.documentId ?? input.id}.txt`,
      excerpt: input.excerpt ?? String(Object.values(input.fields)[0] ?? input.id),
    },
    factType: input.factType,
    fields: input.fields,
    id: input.id,
  };
}

function collapse(facts: ExtractedFact[], factDefs: FactDef[] = genericFactDefs) {
  return collapseExtractedFacts({
    factDefs,
    facts,
    profileId: "test-profile",
  });
}

describe("deterministic extraction identity collapse", () => {
  it("leaves facts with missing identity config as uncollapsed incomplete facts", () => {
    const result = collapse([
      fact({ factType: "NO_IDENTITY", fields: { name: "A" }, id: "raw_1" }),
      fact({ factType: "NO_IDENTITY", fields: { name: "A" }, id: "raw_2" }),
    ]);

    expect(result.collapsedFacts).toHaveLength(2);
    expect(result.summary.uncollapsedCount).toBe(2);
    expect(result.collapsedFacts.every((item) => item.status === "incomplete")).toBe(true);
  });

  it("merges matching normalized keys while preserving source fact ids and deduping evidence", () => {
    const result = collapse([
      fact({
        documentId: "doc_1",
        excerpt: "Ramirez Family Holdings, LLC",
        factType: "ORG",
        fields: { name: "Ramirez Family Holdings, L.L.C." },
        id: "raw_1",
      }),
      fact({
        documentId: "doc_1",
        excerpt: "Ramirez Family Holdings, LLC",
        factType: "ORG",
        fields: { name: "RAMIREZ FAMILY HOLDINGS LLC" },
        id: "raw_2",
      }),
    ]);

    expect(result.collapsedFacts).toHaveLength(1);
    expect(result.collapsedFacts[0]).toMatchObject({
      sourceFactIds: ["raw_1", "raw_2"],
      status: "resolved",
    });
    expect(result.collapsedFacts[0]?.evidence).toHaveLength(1);
  });

  it("preserves conflicts for unequal normalized values and does not mutate raw facts", () => {
    const rawFacts = [
      fact({ factType: "ORG", fields: { amount: "$435,000", name: "City" }, id: "raw_1" }),
      fact({ factType: "ORG", fields: { amount: "$450,000", name: "City" }, id: "raw_2" }),
    ];
    const original = JSON.stringify(rawFacts);
    const result = collapse(rawFacts);

    expect(JSON.stringify(rawFacts)).toBe(original);
    expect(result.collapsedFacts[0]).toMatchObject({
      conflicts: [
        {
          field: "amount",
          values: [
            expect.objectContaining({ value: "$435,000" }),
            expect.objectContaining({ value: "$450,000" }),
          ],
        },
      ],
      status: "conflicting",
    });
  });

  it("mergeWhenUnique merges only when unique-against values are unambiguous", () => {
    const ambiguous = collapse([
      fact({ factType: "UNIQUE", fields: { externalId: "A", kind: "project", name: "Main" }, id: "raw_1" }),
      fact({ factType: "UNIQUE", fields: { externalId: "B", kind: "project", name: "Main" }, id: "raw_2" }),
    ]);
    const unambiguous = collapse([
      fact({ factType: "UNIQUE", fields: { externalId: "A", kind: "project", name: "Main" }, id: "raw_1" }),
      fact({ factType: "UNIQUE", fields: { kind: "project", name: "Main" }, id: "raw_2" }),
    ]);

    expect(ambiguous.collapsedFacts).toHaveLength(2);
    expect(unambiguous.collapsedFacts).toHaveLength(1);
  });

  it("produces deterministic collapsed ids and ordering", () => {
    const rawFacts = [
      fact({ factType: "ORG", fields: { name: "B LLC" }, id: "raw_b" }),
      fact({ factType: "ORG", fields: { name: "A LLC" }, id: "raw_a" }),
    ];
    const first = collapse(rawFacts);
    const second = collapse(rawFacts);

    expect(first.collapsedFacts.map((item) => item.id)).toEqual(
      second.collapsedFacts.map((item) => item.id),
    );
    expect(first.collapsedFacts.map((item) => item.identityKey)).toEqual(
      [...first.collapsedFacts.map((item) => item.identityKey)].sort(),
    );
  });

  it("normalizes key field variants conservatively", () => {
    expect(normalizeFieldValue("Ramirez Family Holdings, L.L.C.", "organization-name"))
      .toBe(normalizeFieldValue("RAMIREZ FAMILY HOLDINGS LLC", "organization-name"));
    expect(normalizeFieldValue("Parcel No. 14", "parcel-number"))
      .toBe(normalizeFieldValue("14", "parcel-number"));
    expect(normalizeFieldValue("$435,000.00", "currency"))
      .toBe(normalizeFieldValue("435000", "currency"));
    expect(normalizeFieldValue("2026-02-20T12:00:00Z", "date")).toBe("2026-02-20");
    expect(normalizeFieldValue("May 4 notes", "date")).toBe("may 4 notes");
    expect(normalizeFieldValue("approximately 0.84 acres", "acreage"))
      .toBe(normalizeFieldValue("0.840 acre", "acreage"));
    expect(normalizeFieldValue("1428 East Braker Lane", "postal-address"))
      .toBe(normalizeFieldValue("1428 E Braker Ln", "postal-address"));
    expect(normalizeFieldValue("1428 East Braker Lane", "postal-address"))
      .not.toBe(normalizeFieldValue("1842 East Loop Road", "postal-address"));
    expect(normalizeFieldValue("parking", "affected-feature"))
      .not.toBe(normalizeFieldValue("customer parking", "affected-feature"));
  });

  it("collapses repeated Eminent Domain entities and preserves address conflicts", () => {
    const result = collapse([
      fact({
        documentId: "doc_1",
        factType: "MATTER_ENTITY",
        fields: { entityType: "property-owner", name: "Ramirez Family Holdings, LLC" },
        id: "owner_1",
      }),
      fact({
        documentId: "doc_2",
        factType: "MATTER_ENTITY",
        fields: { entityType: "property-owner", name: "RAMIREZ FAMILY HOLDINGS LLC" },
        id: "owner_2",
      }),
      fact({
        factType: "PROPERTY_INTEREST",
        fields: {
          address: "1428 East Braker Lane, Austin, Texas",
          interestType: "subject-property",
          parcelNumber: "Parcel 14",
        },
        id: "property_1",
      }),
      fact({
        factType: "PROPERTY_INTEREST",
        fields: {
          address: "1842 East Loop Road, Lone Star, Texas",
          interestType: "subject-property",
          parcelNumber: "Parcel No. 14",
        },
        id: "property_2",
      }),
    ], eminentDomainFactDefs);

    const owner = result.collapsedFacts.find((item) => item.factType === "MATTER_ENTITY");
    const property = result.collapsedFacts.find((item) => item.factType === "PROPERTY_INTEREST");

    expect(owner?.sourceFactIds).toEqual(["owner_1", "owner_2"]);
    expect(property).toMatchObject({
      conflicts: [
        {
          field: "address",
          values: [
            expect.objectContaining({ value: "1428 East Braker Lane, Austin, Texas" }),
            expect.objectContaining({ value: "1842 East Loop Road, Lone Star, Texas" }),
          ],
        },
      ],
      status: "conflicting",
    });
  });

  it("keeps fee-simple and temporary construction easement interests separate", () => {
    const result = collapse([
      fact({
        factType: "PROPERTY_INTEREST",
        fields: { area: "0.84 acres", interestType: "fee-simple", parcelNumber: "Parcel 14" },
        id: "fee_1",
      }),
      fact({
        factType: "PROPERTY_INTEREST",
        fields: { area: "0.840 acre", interestType: "fee-simple", parcelNumber: "14" },
        id: "fee_2",
      }),
      fact({
        factType: "PROPERTY_INTEREST",
        fields: { area: "0.22 acres", interestType: "temporary-construction-easement", parcelNumber: "Parcel 14" },
        id: "tce_1",
      }),
    ], eminentDomainFactDefs);

    const interests = result.collapsedFacts.filter((item) => item.factType === "PROPERTY_INTEREST");

    expect(interests).toHaveLength(2);
    expect(interests.find((item) => item.fields.interestType === "fee-simple")?.sourceFactIds)
      .toEqual(["fee_1", "fee_2"]);
    expect(interests.find((item) =>
      item.fields.interestType === "temporary-construction-easement"
    )?.sourceFactIds).toEqual(["tce_1"]);
  });

  it("collapses offers and preserves competing amounts", () => {
    const result = collapse([
      fact({
        factType: "VALUATION",
        fields: { amount: "$435,000", offerDate: "2026-02-20", parcelNumber: "Parcel 14", valuationType: "final-offer" },
        id: "offer_1",
      }),
      fact({
        factType: "VALUATION",
        fields: { amount: "$450,000", offerDate: "2026-02-20", parcelNumber: "14", valuationType: "final-offer" },
        id: "offer_2",
      }),
    ], eminentDomainFactDefs);

    expect(result.collapsedFacts).toHaveLength(1);
    expect(result.collapsedFacts[0]).toMatchObject({
      conflicts: [
        {
          field: "amount",
          values: [
            expect.objectContaining({ value: "$435,000" }),
            expect.objectContaining({ value: "$450,000" }),
          ],
        },
      ],
      status: "conflicting",
    });
  });

  it("does not collapse condemnor and owner appraisals together", () => {
    const result = collapse([
      fact({
        factType: "VALUATION",
        fields: {
          amount: "$425,000",
          appraiser: "Hill Country Valuation Group",
          effectiveDate: "2026-02-01",
          parcelNumber: "Parcel 14",
          valuationType: "condemnor-appraisal",
        },
        id: "condemnor_1",
      }),
      fact({
        factType: "VALUATION",
        fields: {
          amount: "$610,000",
          appraiser: "Hill Country Valuation Group",
          effectiveDate: "2026-02-01",
          parcelNumber: "Parcel 14",
          valuationType: "owner-appraisal",
        },
        id: "owner_1",
      }),
    ], eminentDomainFactDefs);

    expect(result.collapsedFacts).toHaveLength(2);
  });

  it("collapses repeated events but leaves undated events uncollapsed", () => {
    const result = collapse([
      fact({
        factType: "EVENT",
        fields: { description: "Petition filed.", eventDate: "2026-03-18", eventType: "petition-filed", parcelNumber: "Parcel 14" },
        id: "event_1",
      }),
      fact({
        factType: "EVENT",
        fields: { description: "The City filed the petition.", eventDate: "2026-03-18", eventType: "petition-filed", parcelNumber: "14" },
        id: "event_2",
      }),
      fact({
        factType: "EVENT",
        fields: { description: "A hearing was scheduled.", eventType: "hearing-scheduled" },
        id: "event_3",
      }),
      fact({
        factType: "EVENT",
        fields: { description: "Special commissioners hearing scheduled.", eventType: "hearing-scheduled" },
        id: "event_4",
      }),
    ], eminentDomainFactDefs);

    const petition = result.collapsedFacts.find((item) =>
      item.sourceFactIds.includes("event_1")
    );
    const undated = result.collapsedFacts.filter((item) =>
      item.sourceFactIds.includes("event_3") || item.sourceFactIds.includes("event_4")
    );

    expect(petition?.sourceFactIds).toEqual(["event_1", "event_2"]);
    expect(undated).toHaveLength(2);
  });

  it("collapses matching property impacts and preserves competing quantified values", () => {
    const result = collapse([
      fact({
        factType: "PROPERTY_IMPACT",
        fields: {
          affectedFeature: "customer parking",
          assertionStatus: "assumed",
          category: "parking",
          description: "The appraisal assumes nine spaces will be lost.",
          parcelNumber: "Parcel 14",
          quantifiedImpact: "9 spaces",
          sourceRole: "appraiser",
        },
        id: "impact_1",
      }),
      fact({
        factType: "PROPERTY_IMPACT",
        fields: {
          affectedFeature: "customer parking",
          assertionStatus: "alleged",
          category: "parking",
          description: "The owner alleges approximately fourteen spaces will be lost.",
          parcelNumber: "14",
          quantifiedImpact: "approximately 14 spaces",
          sourceRole: "owner",
        },
        id: "impact_2",
      }),
      fact({
        factType: "PROPERTY_IMPACT",
        fields: {
          affectedFeature: "parking",
          category: "parking",
          description: "Generic parking concern.",
          parcelNumber: "14",
        },
        id: "impact_3",
      }),
    ], eminentDomainFactDefs);

    const customerParking = result.collapsedFacts.find((item) =>
      item.sourceFactIds.includes("impact_1")
    );

    expect(result.collapsedFacts).toHaveLength(2);
    expect(customerParking).toMatchObject({
      conflicts: expect.arrayContaining([
        expect.objectContaining({
          field: "quantifiedImpact",
        }),
        expect.objectContaining({
          field: "sourceRole",
        }),
        expect.objectContaining({
          field: "assertionStatus",
        }),
      ]),
      sourceFactIds: ["impact_1", "impact_2"],
      status: "conflicting",
    });
  });

  it("does not call an AI provider during collapse", () => {
    const result = collapseExtractedFacts({
      factDefs: eminentDomainFactsProfile.factDefs,
      facts: [
        fact({
          factType: "MATTER_ENTITY",
          fields: { entityType: "property-owner", name: "Ramirez Family Holdings LLC" },
          id: "owner_1",
        }),
      ],
      profileId: eminentDomainFactsProfile.id,
    });

    expect(result.summary.rawFactCount).toBe(1);
    expect(result.collapsedFacts).toHaveLength(1);
  });
});
