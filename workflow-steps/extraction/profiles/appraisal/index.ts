import { createFactExtractionProfile } from "../../generic-fact-profile";
import type { FactDef, FactFieldDef } from "../../fact-def";

const stringField = (name: string, description: string, required = false): FactFieldDef => ({ description, name, required, type: "string" });
const numberField = (name: string, description: string, required = false): FactFieldDef => ({ description, name, normalizer: "number", required, type: "number" });
const dateField = (name: string, description: string): FactFieldDef => ({ description, name, normalizer: "date", required: false, type: "date" });

const factDefs: FactDef[] = [
  {
    factType: "APPRAISAL_IDENTIFICATION",
    description: "Identification and scope stated by an appraisal or appraisal addendum.",
    extraction: { instructions: "Extract only identification stated by an appraisal. Do not treat supporting correspondence as an appraisal conclusion.", fields: [
      stringField("appraiserName", "Appraiser name"), stringField("appraisalFirm", "Appraisal firm"), dateField("reportDate", "Report date"), dateField("effectiveDate", "Effective valuation date"), stringField("client", "Client or condemning entity"), stringField("appraisalPurpose", "Stated appraisal purpose"), stringField("propertyInterest", "Property interest appraised"), stringField("reportType", "Report type, if stated"),
    ] },
    identity: { scope: "document", strategy: "none" },
  },
  {
    factType: "APPRAISAL_PROPERTY",
    description: "Subject property, larger parcel, acquisition, and remainder facts.",
    extraction: { instructions: "Extract stated property facts. Preserve differing values from appraisal and supporting documents as separate evidence.", fields: [
      stringField("owner", "Property owner"), stringField("address", "Property address"), stringField("parcelId", "Parcel identifier"), stringField("largerParcelDescription", "Larger parcel description"), stringField("largerParcelArea", "Larger parcel area"), stringField("areaAcquired", "Area acquired"), stringField("remainderArea", "Remainder area"), stringField("propertyInterestAcquired", "Estate or easement acquired"), stringField("existingUse", "Existing use"), stringField("zoning", "Zoning"), stringField("utilities", "Utilities"), stringField("access", "Access"), stringField("frontage", "Frontage"), stringField("improvements", "Improvements"),
    ] },
    identity: { scope: "matter", strategy: "none" },
  },
  {
    factType: "APPRAISAL_VALUATION",
    description: "A valuation approach, highest-and-best-use conclusion, or value conclusion stated by the appraiser.",
    extraction: { instructions: "Extract one stated valuation conclusion per fact. Set concept to the precise listed concept and do not calculate an unstated value.", fields: [
      { name: "concept", required: true, type: "enum", enumValues: ["highest_and_best_use_before", "highest_and_best_use_after", "approach_considered", "approach_used", "before_value", "part_taken_value", "after_value", "remainder_damages", "enhancements", "cost_to_cure", "total_compensation"] },
      stringField("statedValue", "Conclusion exactly as stated", true), numberField("numericValue", "Normalized monetary value when applicable"), stringField("supportingBasis", "Appraiser's stated supporting basis"),
    ] },
    identity: { scope: "document", strategy: "multiKey", rules: [{ action: "merge", fields: ["concept"] }], mergeRules: { fieldPolicies: { concept: "identity", numericValue: "conflict", statedValue: "conflict", supportingBasis: "narrative" }, preserveAlternateValues: ["numericValue", "statedValue"] } },
  },
  {
    factType: "APPRAISAL_IMPACT",
    description: "A property impact addressed, rejected, or treated as immaterial by the appraisal or a supporting document.",
    extraction: { instructions: "Distinguish the source's stated position. Do not decide legal compensability.", fields: [
      { name: "category", required: true, type: "enum", enumValues: ["access", "visibility", "parking", "drainage", "utilities", "frontage", "parcel_shape", "site_circulation", "development_potential", "temporary_construction", "other"] },
      stringField("sourceRole", "appraisal or supporting_document", true), stringField("statedConclusion", "Stated impact conclusion", true), stringField("basis", "Evidence or plan relied upon"), stringField("assumption", "Assumption driving the conclusion"),
    ] },
    identity: { scope: "matter", strategy: "none" },
  },
  {
    factType: "APPRAISAL_ASSUMPTION",
    description: "An ordinary assumption, extraordinary assumption, hypothetical condition, or relied-upon project configuration.",
    extraction: { instructions: "Extract only an assumption or condition directly stated or expressly relied upon.", fields: [
      { name: "assumptionType", required: true, type: "enum", enumValues: ["ordinary", "extraordinary", "hypothetical_condition", "project_configuration", "access", "zoning", "utilities", "future_development", "other"] },
      stringField("statement", "Assumption or condition", true), stringField("effectOnAnalysis", "Stated effect on analysis"),
    ] },
    identity: { scope: "document", strategy: "none" },
  },
  {
    factType: "APPRAISAL_COMPARABLE_SALE",
    description: "One comparable sale used or discussed by the appraiser.",
    extraction: { instructions: "Extract one fact per comparable. Do not infer missing sale details or adjustments.", fields: [
      stringField("comparableId", "Comparable identifier", true), stringField("location", "Address or location"), dateField("saleDate", "Sale date"), numberField("salePrice", "Sale price"), stringField("landArea", "Land area"), stringField("unitPrice", "Unit price"), stringField("zoning", "Zoning"), stringField("use", "Use"), stringField("characteristics", "Relevant characteristics"), stringField("adjustments", "Adjustment categories and amounts"), stringField("adjustedUnitValue", "Adjusted unit value"), stringField("relevanceExplanation", "Appraiser explanation for relevance"),
    ] },
    identity: { scope: "document", strategy: "multiKey", rules: [{ action: "merge", fields: ["comparableId"] }], mergeRules: { fieldPolicies: { comparableId: "identity", adjustments: "narrative", characteristics: "narrative", relevanceExplanation: "narrative" }, preserveAlternateValues: ["salePrice", "unitPrice", "adjustedUnitValue"] } },
  },
  {
    factType: "APPRAISAL_MISSING_EVIDENCE",
    description: "A document, plan, workfile item, or factual support expressly identified as missing, unavailable, or not reviewed.",
    extraction: { instructions: "Do not manufacture customary documents. Extract only an express reference to missing, unavailable, or unreviewed evidence.", fields: [stringField("item", "Missing or unreviewed evidence", true), stringField("effect", "Stated effect on analysis")] },
    identity: { scope: "matter", strategy: "none" },
  },
];

export const condemnorAppraisalExtractionProfile = createFactExtractionProfile({
  description: "Extract cited appraisal methodology, conclusions, assumptions, impacts, comparable sales, and expressly missing evidence.",
  factDefs,
  id: "condemnor-appraisal-review",
  itemLabel: "appraisal fact",
  itemPluralLabel: "appraisal facts",
  label: "Condemnor Appraisal Facts",
  maxOutputTokens: 12000,
  profileInstructions: [
    "Use only the selected document window.",
    "Distinguish appraisal conclusions from facts asserted in supporting documents.",
    "Return no fact when a value is not directly supported; do not infer appraisal methodology or conclusions.",
    "Preserve contradictory values as separate extracted facts with direct excerpts.",
    "Never decide professional-standards compliance, legal compensability, or whether the appraiser is correct.",
  ].join(" "),
  taskId: "condemnor-appraisal-review",
});
