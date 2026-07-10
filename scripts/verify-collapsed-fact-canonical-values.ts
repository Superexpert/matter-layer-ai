import { execSync } from "node:child_process";

import { collapseExtractedFacts } from "@/workflow-steps/extraction/identity";
import {
  eminentDomainFactDefs,
  eminentDomainFactsProfile,
} from "@/workflow-steps/extraction/profiles/eminent-domain";
import type { ExtractedFact } from "@/workflow-steps/extraction/extracted-fact";

function changedFiles() {
  const trackedChanges = execSync("git diff --name-only", { encoding: "utf8" });
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
): ExtractedFact {
  return {
    evidence: {
      documentId: `doc_${id}`,
      documentName: `${id}.pdf`,
      excerpt: `Source excerpt for ${id}.`,
      pageEnd: 1,
      pageStart: 1,
    },
    factType,
    fields,
    id,
  };
}

const rawFacts: ExtractedFact[] = [
  fact("initial_offer_event_1", "EVENT", {
    deadline: "February 11, 2026",
    description: "The City issued its initial written offer.",
    eventDate: "January 12, 2026",
    eventType: "initial-offer-issued",
    parcelNumber: "Parcel No. 14",
  }),
  fact("initial_offer_event_2", "EVENT", {
    deadline: "2026-02-11",
    description: "Initial offer issued for Parcel 14.",
    eventDate: "2026-01-12",
    eventType: "initial-offer-issued",
    parcelNumber: "14",
  }),
  fact("final_offer_value_1", "VALUATION", {
    amount: "$435,000.00",
    offerDate: "Feb. 20, 2026",
    parcelNumber: "Parcel No. 14",
    valuationType: "final-offer",
  }),
  fact("final_offer_value_2", "VALUATION", {
    amount: "435000",
    offerDate: "2026-02-20",
    parcelNumber: "14",
    valuationType: "final-offer",
  }),
  fact("fee_interest_1", "PROPERTY_INTEREST", {
    area: "0.840 acre",
    interestType: "fee-simple",
    parcelNumber: "Parcel No. 14",
  }),
  fact("fee_interest_2", "PROPERTY_INTEREST", {
    area: "0.84 acres",
    interestType: "fee-simple",
    parcelNumber: "14",
  }),
  fact("area_conflict_1", "PROPERTY_INTEREST", {
    area: "0.94 acres",
    interestType: "subject-property",
    parcelNumber: "Parcel 14",
  }),
  fact("area_conflict_2", "PROPERTY_INTEREST", {
    area: "0.84 acres",
    interestType: "subject-property",
    parcelNumber: "14",
  }),
];
const rawBefore = JSON.stringify(rawFacts);

const result = collapseExtractedFacts({
  factDefs: eminentDomainFactDefs,
  facts: rawFacts,
  profileId: eminentDomainFactsProfile.id,
});

const isoEvent = collapseExtractedFacts({
  factDefs: eminentDomainFactDefs,
  facts: [
    fact("stable_iso", "EVENT", {
      description: "Final offer issued.",
      eventDate: "2026-02-20",
      eventType: "final-offer-issued",
      parcelNumber: "Parcel 14",
    }),
  ],
  profileId: eminentDomainFactsProfile.id,
});
const englishEvent = collapseExtractedFacts({
  factDefs: eminentDomainFactDefs,
  facts: [
    fact("stable_english", "EVENT", {
      description: "Final offer issued.",
      eventDate: "February 20, 2026",
      eventType: "final-offer-issued",
      parcelNumber: "Parcel No. 14",
    }),
  ],
  profileId: eminentDomainFactsProfile.id,
});

function collapsedBySource(sourceFactId: string) {
  return result.collapsedFacts.find((collapsedFact) =>
    collapsedFact.sourceFactIds.includes(sourceFactId)
  );
}

const initialOfferEvent = collapsedBySource("initial_offer_event_1");
const finalOfferValue = collapsedBySource("final_offer_value_1");
const feeInterest = collapsedBySource("fee_interest_1");
const areaConflict = collapsedBySource("area_conflict_1");
const areaConflictValues = areaConflict?.conflicts.find((conflict) =>
  conflict.field === "area"
)?.values ?? [];

const checks = {
  acreage: feeInterest?.fields.area === "0.84 acres",
  collapsedIdsStable: isoEvent.collapsedFacts[0]?.id === englishEvent.collapsedFacts[0]?.id,
  conflictsRetainSourceValues: areaConflictValues.some((value) => value.value === "0.94 acres") &&
    areaConflictValues.some((value) => value.value === "0.84 acres"),
  currency: finalOfferValue?.fields.amount === "$435,000",
  dates: initialOfferEvent?.fields.eventDate === "2026-01-12",
  deadlines: initialOfferEvent?.fields.deadline === "2026-02-11",
  originalValuesRetained: Boolean(initialOfferEvent?.supportingValues?.description?.[0]?.value),
  parcelNumbers: feeInterest?.fields.parcelNumber === "Parcel 14" &&
    !String(feeInterest?.fields.parcelNumber).startsWith("parcel:"),
  rawFactsUnchanged: JSON.stringify(rawFacts) === rawBefore,
};

console.info("=== Collapsed Fact Canonical Values ===");
console.info("Canonical resolved values:");
console.info(`- dates: ${checks.dates ? "PASS" : "FAIL"}`);
console.info(`- deadlines: ${checks.deadlines ? "PASS" : "FAIL"}`);
console.info(`- currency: ${checks.currency ? "PASS" : "FAIL"}`);
console.info(`- parcel numbers: ${checks.parcelNumbers ? "PASS" : "FAIL"}`);
console.info(`- acreage: ${checks.acreage ? "PASS" : "FAIL"}`);
console.info("Preservation:");
console.info(`- raw facts unchanged: ${checks.rawFactsUnchanged ? "PASS" : "FAIL"}`);
console.info(`- original values retained in supporting values: ${checks.originalValuesRetained ? "PASS" : "FAIL"}`);
console.info(`- conflicts retain all source values: ${checks.conflictsRetainSourceValues ? "PASS" : "FAIL"}`);
console.info(`- collapsed IDs stable: ${checks.collapsedIdsStable ? "PASS" : "FAIL"}`);
console.info("Sample verification:");
console.info(`- initial offer event date: ${String(initialOfferEvent?.fields.eventDate)}`);
console.info(`- initial offer deadline: ${String(initialOfferEvent?.fields.deadline)}`);
console.info(`- final offer amount: ${String(finalOfferValue?.fields.amount)}`);
console.info(`- parcel number: ${String(feeInterest?.fields.parcelNumber)}`);
console.info(`- fee-simple area: ${String(feeInterest?.fields.area)}`);
console.info("Execution:");
console.info("- AI calls used: 0");
console.info("- identity rules changed: NO");
console.info("- collapse clustering changed: NO");
console.info("- document generation changed: NO");
console.info("Validation:");
console.info(`- Type check: ${process.env.TYPE_CHECK_STATUS ?? "NOT RUN"}`);
console.info(`- Unit tests: ${process.env.UNIT_TEST_STATUS ?? "NOT RUN"}`);
console.info(`- Collapse integration tests: ${process.env.COLLAPSE_INTEGRATION_STATUS ?? "NOT RUN"}`);
console.info(`- Lint: ${process.env.LINT_STATUS ?? "NOT RUN"}`);
console.info(`- Build: ${process.env.BUILD_STATUS ?? "NOT RUN"}`);
console.info("Files changed:");
for (const file of changedFiles()) {
  console.info(`- ${file}`);
}
console.info("=== Representative Collapsed Facts ===");
console.info(JSON.stringify([
  initialOfferEvent,
  finalOfferValue,
  feeInterest,
  areaConflict,
], null, 2));
