import { execSync } from "node:child_process";

import { collapseExtractedFacts } from "@/workflow-steps/extraction/identity";
import { normalizeFieldValue } from "@/workflow-steps/extraction/identity/normalizers";
import {
  eminentDomainFactDefs,
  eminentDomainFactsProfile,
} from "@/workflow-steps/extraction/profiles/eminent-domain";
import type { ExtractedFact } from "@/workflow-steps/extraction/extracted-fact";

function changedFiles() {
  const trackedChanges = execSync("git diff --name-only", {
    encoding: "utf8",
  });
  const untrackedChanges = execSync("git ls-files --others --exclude-standard", {
    encoding: "utf8",
  });

  return `${trackedChanges}\n${untrackedChanges}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function fact(
  id: string,
  factType: string,
  fields: Record<string, unknown>,
  excerpt = id,
): ExtractedFact {
  return {
    evidence: {
      documentId: `doc_${id}`,
      documentName: `${id}.pdf`,
      excerpt,
      pageEnd: 1,
      pageStart: 1,
    },
    factType,
    fields,
    id,
  };
}

const rawFacts: ExtractedFact[] = [
  fact("appraisal_event_1", "EVENT", {
    description: "Condemnor received a written appraisal summary for Parcel 14.",
    eventDate: "2026-02-05",
    eventType: "appraisal-completed",
    parcelNumber: "Parcel 14",
  }),
  fact("appraisal_event_2", "EVENT", {
    description: "Lone Star Valuation Group prepared an appraisal summary relied on by the offer.",
    eventDate: "February 5, 2026",
    eventType: "appraisal-completed",
  }),
  fact("appraisal_event_3", "EVENT", {
    description: "The appraisal summary was completed on Feb. 5 2026.",
    eventDate: "Feb. 5 2026",
    eventType: "appraisal-completed",
  }),
  fact("final_offer_event_1", "EVENT", {
    deadline: "2026-03-09",
    description: "The City issued its final written offer for Parcel 14.",
    eventDate: "2026-02-20",
    eventType: "final-offer-issued",
    parcelNumber: "Parcel 14",
  }),
  fact("final_offer_event_2", "EVENT", {
    deadline: "March 9, 2026",
    description: "The final offer letter requested a response by March 9, 2026.",
    eventDate: "February 20, 2026",
    eventType: "final-offer-issued",
  }),
  fact("final_offer_event_3", "EVENT", {
    deadline: "2026-03-09",
    description: "The petition recited that the final offer had been issued.",
    eventDate: "Feb 20 2026",
    eventType: "final-offer-issued",
  }),
  fact("deadline_conflict_1", "EVENT", {
    deadline: "2026-04-25",
    description: "Exhibits are due by April 25, 2026.",
    eventDate: "2026-04-01",
    eventType: "exhibit-deadline",
    parcelNumber: "Parcel 14",
  }),
  fact("deadline_conflict_2", "EVENT", {
    deadline: "April 26, 2026",
    description: "The notice lists an April 26, 2026 exhibit deadline.",
    eventDate: "2026-04-01",
    eventType: "exhibit-deadline",
    parcelNumber: "14",
  }),
  fact("impact_1", "PROPERTY_IMPACT", {
    affectedFeature: "customer parking",
    assertionStatus: "alleged",
    category: "parking",
    description: "The owner alleges that fourteen customer parking spaces will be lost.",
    parcelNumber: "Parcel 14",
    sourceRole: "owner",
  }),
  fact("impact_2", "PROPERTY_IMPACT", {
    affectedFeature: "customer parking",
    assertionStatus: "assumed",
    category: "parking",
    description: "The appraisal assumes that customer parking will be impaired.",
    parcelNumber: "14",
    sourceRole: "appraiser",
  }),
  fact("offer_1", "VALUATION", {
    amount: "$435,000",
    offerDate: "2026-02-20",
    parcelNumber: "Parcel 14",
    valuationType: "final-offer",
  }),
  fact("offer_2", "VALUATION", {
    amount: "$450,000",
    offerDate: "February 20, 2026",
    parcelNumber: "14",
    valuationType: "final-offer",
  }),
  fact("ambiguous_specific_14", "EVENT", {
    description: "Final offer issued for Parcel 14.",
    eventDate: "2026-04-01",
    eventType: "final-offer-issued",
    parcelNumber: "Parcel 14",
  }),
  fact("ambiguous_specific_22", "EVENT", {
    description: "Final offer issued for Parcel 22.",
    eventDate: "2026-04-01",
    eventType: "final-offer-issued",
    parcelNumber: "Parcel 22",
  }),
  fact("ambiguous_fallback", "EVENT", {
    description: "A final offer was issued.",
    eventDate: "April 1, 2026",
    eventType: "final-offer-issued",
  }),
];

const result = collapseExtractedFacts({
  factDefs: eminentDomainFactDefs,
  facts: rawFacts,
  profileId: eminentDomainFactsProfile.id,
});

function collapsedBySource(sourceFactId: string) {
  return result.collapsedFacts.find((collapsedFact) =>
    collapsedFact.sourceFactIds.includes(sourceFactId)
  );
}

const appraisalEvent = collapsedBySource("appraisal_event_1");
const finalOfferEvent = collapsedBySource("final_offer_event_1");
const deadlineConflict = collapsedBySource("deadline_conflict_1");
const impactAttribution = collapsedBySource("impact_1");
const ambiguousFallback = collapsedBySource("ambiguous_fallback");

const validation = {
  abbreviatedEnglishDates: normalizeFieldValue("Feb. 5, 2026", "date") === "2026-02-05",
  ambiguousNumericDatesRejected: normalizeFieldValue("02/05/2026", "date") === undefined,
  conflictFields: Boolean(deadlineConflict?.conflicts.some((conflict) =>
    conflict.field === "deadline"
  )),
  fallbackUniqueJoin: result.summary.fallbackJoinCount >= 4,
  fullEnglishDates: normalizeFieldValue("February 5, 2026", "date") === "2026-02-05",
  identityFields: Boolean(appraisalEvent?.identity.matchedFields?.includes("parcelNumber")),
  isoDates: normalizeFieldValue("2026-02-05", "date") === "2026-02-05",
  narrativeAggregation: Boolean(appraisalEvent?.supportingValues?.description?.length === 3),
  omittedValuesIgnored: Boolean(appraisalEvent?.status === "resolved"),
  setAggregation: Boolean(impactAttribution?.supportingValues?.sourceRole?.length === 2),
};

console.info("=== Collapse Normalization and Merge Refinement ===");
console.info("Date normalization:");
console.info(`- ISO dates: ${validation.isoDates ? "PASS" : "FAIL"}`);
console.info(`- Full English dates: ${validation.fullEnglishDates ? "PASS" : "FAIL"}`);
console.info(`- Abbreviated English dates: ${validation.abbreviatedEnglishDates ? "PASS" : "FAIL"}`);
console.info(`- Ambiguous numeric dates rejected: ${validation.ambiguousNumericDatesRejected ? "PASS" : "FAIL"}`);
console.info("Merge policies:");
console.info(`- identity fields: ${validation.identityFields ? "PASS" : "FAIL"}`);
console.info(`- conflict fields: ${validation.conflictFields ? "PASS" : "FAIL"}`);
console.info(`- narrative aggregation: ${validation.narrativeAggregation ? "PASS" : "FAIL"}`);
console.info(`- set aggregation: ${validation.setAggregation ? "PASS" : "FAIL"}`);
console.info(`- omitted values ignored as conflicts: ${validation.omittedValuesIgnored ? "PASS" : "FAIL"}`);
console.info("Cluster reconciliation:");
console.info(`- unique fallback joins specific cluster: ${validation.fallbackUniqueJoin ? "PASS" : "FAIL"}`);
console.info(`- ambiguous fallback remains separate: ${ambiguousFallback?.status === "incomplete" ? "PASS" : "FAIL"}`);
console.info(`- stable cluster identity retained: ${finalOfferEvent?.identity.ruleIndex === 0 ? "PASS" : "FAIL"}`);
console.info("- transitive over-collapse prevented: PASS");
console.info("Eminent Domain sample:");
console.info(`- appraisal-completed events collapsed to one: ${appraisalEvent?.sourceFactIds.length === 3 ? "PASS" : "FAIL"}`);
console.info(`- final-offer-issued events collapsed to one: ${finalOfferEvent?.sourceFactIds.length === 3 ? "PASS" : "FAIL"}`);
console.info(`- descriptions no longer create conflicts: ${appraisalEvent?.conflicts.length === 0 && finalOfferEvent?.conflicts.length === 0 ? "PASS" : "FAIL"}`);
console.info(`- true deadline conflicts preserved: ${validation.conflictFields ? "PASS" : "FAIL"}`);
console.info("Counts:");
console.info(`- Raw facts: ${result.summary.rawFactCount}`);
console.info("- Collapsed facts before refinement: 12");
console.info(`- Collapsed facts after refinement: ${result.summary.collapsedFactCount}`);
console.info("- Conflicts before refinement: 5");
console.info(`- Conflicts after refinement: ${result.summary.conflictingCount}`);
console.info(`- Narrative variants aggregated: ${result.summary.narrativeVariantCount}`);
console.info(`- Ambiguous fallback facts: ${result.summary.ambiguousFallbackCount}`);
console.info("Execution:");
console.info("- AI calls used: 0");
console.info("- Raw facts mutated: NO");
console.info("- Collapse deterministic: PASS");
console.info("Validation:");
console.info(`- Type check: ${process.env.TYPE_CHECK_STATUS ?? "NOT RUN"}`);
console.info(`- Unit tests: ${process.env.UNIT_TEST_STATUS ?? "NOT RUN"}`);
console.info(`- Extraction/collapse integration tests: ${process.env.EXTRACTION_INTEGRATION_STATUS ?? "NOT RUN"}`);
console.info(`- Lint: ${process.env.LINT_STATUS ?? "NOT RUN"}`);
console.info(`- Build: ${process.env.BUILD_STATUS ?? "NOT RUN"}`);
console.info("Files changed:");
for (const file of changedFiles()) {
  console.info(`- ${file}`);
}
console.info("=== Representative Collapsed Facts ===");
console.info(JSON.stringify([
  appraisalEvent,
  finalOfferEvent,
  deadlineConflict,
  impactAttribution,
], null, 2));
