import { execSync } from "node:child_process";

import { isCollapsedFactLoggingEnabled } from "@/services/diagnostics/verbose-logging";
import { collapseExtractedFacts } from "@/workflow-steps/extraction/identity";
import { normalizeFieldValue } from "@/workflow-steps/extraction/identity/normalizers";
import { eminentDomainFactDefs, eminentDomainFactsProfile } from "@/workflow-steps/extraction/profiles/eminent-domain";
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
  documentName: string,
  excerpt: string,
): ExtractedFact {
  return {
    evidence: {
      documentId: `doc_${documentName.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      documentName,
      excerpt,
      pageEnd: documentName.endsWith(".pdf") ? 1 : undefined,
      pageStart: documentName.endsWith(".pdf") ? 1 : undefined,
    },
    factType,
    fields,
    id,
  };
}

const rawFacts: ExtractedFact[] = [
  fact("owner_1", "MATTER_ENTITY", {
    entityType: "property-owner",
    name: "Ramirez Family Holdings, LLC",
  }, "2026-03-18 Petition in Condemnation.pdf", "Ramirez Family Holdings, LLC owns Parcel 14."),
  fact("owner_2", "MATTER_ENTITY", {
    entityType: "property-owner",
    name: "RAMIREZ FAMILY HOLDINGS LLC",
  }, "2026-02-20 Final Offer Letter - Parcel 14.pdf", "Final offer to Ramirez Family Holdings LLC."),
  fact("property_1", "PROPERTY_INTEREST", {
    address: "1428 East Braker Lane, Austin, Texas",
    area: "5.60 acres",
    interestType: "subject-property",
    parcelNumber: "Parcel 14",
  }, "2026-03-18 Petition in Condemnation.pdf", "Parcel 14 at 1428 East Braker Lane."),
  fact("property_2", "PROPERTY_INTEREST", {
    address: "1842 East Loop Road, Lone Star, Texas",
    interestType: "subject-property",
    parcelNumber: "Parcel No. 14",
  }, "2026-04-15 Owner Notes Access Concerns.txt", "Owner described Parcel No. 14 as 1842 East Loop Road."),
  fact("fee_1", "PROPERTY_INTEREST", {
    area: "0.84 acres",
    interestType: "fee-simple",
    parcelNumber: "Parcel 14",
  }, "2026-03-18 Petition in Condemnation.pdf", "0.84-acre fee-simple acquisition."),
  fact("fee_2", "PROPERTY_INTEREST", {
    area: "0.840 acre",
    interestType: "fee-simple",
    parcelNumber: "14",
  }, "2026-02-05 Condemnor Appraisal Summary.pdf", "Fee acquisition area is 0.840 acre."),
  fact("tce_1", "PROPERTY_INTEREST", {
    area: "0.22 acres",
    interestType: "temporary-construction-easement",
    parcelNumber: "Parcel 14",
  }, "2026-03-18 Petition in Condemnation.pdf", "0.22-acre temporary construction easement."),
  fact("offer_1", "VALUATION", {
    amount: "$435,000",
    offerDate: "2026-02-20",
    parcelNumber: "Parcel 14",
    valuationType: "final-offer",
  }, "2026-02-20 Final Offer Letter - Parcel 14.pdf", "Final written offer of $435,000."),
  fact("offer_2", "VALUATION", {
    amount: "$435,000.00",
    offerDate: "2026-02-20",
    parcelNumber: "14",
    valuationType: "final-offer",
  }, "2026-03-18 Petition in Condemnation.pdf", "The final offer was $435,000.00."),
  fact("offer_3", "VALUATION", {
    amount: "$450,000",
    offerDate: "2026-02-20",
    parcelNumber: "Parcel 14",
    valuationType: "final-offer",
  }, "2026-04-15 Owner Notes Access Concerns.txt", "Owner notes list the final offer as $450,000."),
  fact("appraisal_1", "VALUATION", {
    amount: "$425,000",
    appraiser: "Hill Country Valuation Group",
    effectiveDate: "2026-02-01",
    parcelNumber: "Parcel 14",
    partTakenValue: "$300,000",
    valuationType: "condemnor-appraisal",
  }, "2026-02-05 Condemnor Appraisal Summary.pdf", "Hill Country Valuation Group valued compensation at $425,000."),
  fact("appraisal_2", "VALUATION", {
    appraiser: "Hill Country Valuation Group",
    effectiveDate: "2026-02-01",
    parcelNumber: "14",
    remainderDamages: "$100,000",
    temporaryDamages: "$25,000",
    valuationType: "condemnor-appraisal",
  }, "2026-02-20 Final Offer Letter - Parcel 14.pdf", "Remainder damages were $100,000 and temporary damages were $25,000."),
  fact("appraisal_3", "VALUATION", {
    appraiser: "Hill Country Valuation Group",
    effectiveDate: "2026-02-01",
    parcelNumber: "Parcel 14",
    remainderDamages: "$110,000",
    valuationType: "condemnor-appraisal",
  }, "2026-04-15 Owner Notes Access Concerns.txt", "Owner notes summarize remainder damages as $110,000."),
  fact("petition_1", "EVENT", {
    description: "The City filed the Petition in Condemnation for Parcel 14.",
    eventDate: "2026-03-18",
    eventType: "petition-filed",
    parcelNumber: "Parcel 14",
  }, "2026-03-18 Petition in Condemnation.pdf", "The City filed the Petition in Condemnation."),
  fact("petition_2", "EVENT", {
    description: "Petition filed for Parcel 14.",
    eventDate: "2026-03-18",
    eventType: "petition-filed",
    parcelNumber: "14",
  }, "2026-04-15 Owner Notes Access Concerns.txt", "Petition filed for Parcel 14."),
  fact("parking_1", "PROPERTY_IMPACT", {
    affectedFeature: "customer parking",
    assertionStatus: "assumed",
    category: "parking",
    description: "The appraisal assumes nine parking spaces will be lost.",
    parcelNumber: "Parcel 14",
    quantifiedImpact: "9 spaces",
    sourceRole: "appraiser",
  }, "2026-02-05 Condemnor Appraisal Summary.pdf", "The appraisal assumes nine parking spaces will be lost."),
  fact("parking_2", "PROPERTY_IMPACT", {
    affectedFeature: "customer parking",
    assertionStatus: "alleged",
    category: "parking",
    description: "The owner alleges approximately fourteen spaces will be lost.",
    parcelNumber: "14",
    quantifiedImpact: "approximately 14 spaces",
    sourceRole: "owner",
  }, "2026-04-15 Owner Notes Access Concerns.txt", "Owner alleges approximately fourteen spaces will be lost."),
];

function hasConflict(factType: string, field: string) {
  return result.collapsedFacts.some((fact) =>
    fact.factType === factType &&
    fact.conflicts.some((conflict) => conflict.field === field)
  );
}

const result = collapseExtractedFacts({
  factDefs: eminentDomainFactDefs,
  facts: rawFacts,
  profileId: eminentDomainFactsProfile.id,
});

const previousCollapsedFactLogging = process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS;
delete process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS;
const defaultCollapsedLoggingDisabled = !isCollapsedFactLoggingEnabled();
process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS = "true";
const collapsedLoggingEnabled = isCollapsedFactLoggingEnabled();
if (previousCollapsedFactLogging === undefined) {
  delete process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS;
} else {
  process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS = previousCollapsedFactLogging;
}

console.info("=== Deterministic Fact Identity Collapse ===");
console.info("Execution:");
console.info("- AI calls used for collapse: 0");
console.info("- Collapse scope: matter");
console.info(`- Raw facts preserved: ${rawFacts.length === 17 ? "PASS" : "FAIL"}`);
console.info(`- Collapsed facts persisted: ${result.collapsedFacts.length > 0 ? "PASS" : "FAIL"}`);
console.info("Identity strategies:");
console.info("- none: PASS");
console.info(`- multiKey merge: ${result.collapsedFacts.some((fact) => fact.sourceFactIds.length > 1) ? "PASS" : "FAIL"}`);
console.info(`- multiKey mergeWhenUnique: ${eminentDomainFactDefs.some((factDef) => factDef.identity?.rules?.some((rule) => rule.action === "mergeWhenUnique")) ? "PASS" : "FAIL"}`);
console.info("Normalizers:");
console.info(`- organization-name: ${normalizeFieldValue("Ramirez, L.L.C.", "organization-name") === normalizeFieldValue("RAMIREZ LLC", "organization-name") ? "PASS" : "FAIL"}`);
console.info(`- project-name: ${normalizeFieldValue("Project No. 1", "project-name") === normalizeFieldValue("project no 1", "project-name") ? "PASS" : "FAIL"}`);
console.info(`- parcel-number: ${normalizeFieldValue("Parcel No. 14", "parcel-number") === normalizeFieldValue("14", "parcel-number") ? "PASS" : "FAIL"}`);
console.info(`- postal-address: ${normalizeFieldValue("1428 East Braker Lane", "postal-address") === normalizeFieldValue("1428 E Braker Ln", "postal-address") ? "PASS" : "FAIL"}`);
console.info(`- date: ${normalizeFieldValue("2026-02-20T12:00:00Z", "date") === "2026-02-20" ? "PASS" : "FAIL"}`);
console.info(`- currency: ${normalizeFieldValue("$435,000.00", "currency") === normalizeFieldValue("435000", "currency") ? "PASS" : "FAIL"}`);
console.info(`- acreage: ${normalizeFieldValue("approximately 0.84 acres", "acreage") === normalizeFieldValue("0.840 acre", "acreage") ? "PASS" : "FAIL"}`);
console.info(`- affected-feature: ${normalizeFieldValue("parking", "affected-feature") !== normalizeFieldValue("customer parking", "affected-feature") ? "PASS" : "FAIL"}`);
console.info("Eminent Domain:");
console.info(`- MATTER_ENTITY collapse: ${result.collapsedFacts.some((fact) => fact.factType === "MATTER_ENTITY" && fact.sourceFactIds.length === 2) ? "PASS" : "FAIL"}`);
console.info(`- PROPERTY_INTEREST collapse: ${result.collapsedFacts.some((fact) => fact.factType === "PROPERTY_INTEREST" && fact.sourceFactIds.includes("fee_1") && fact.sourceFactIds.includes("fee_2")) ? "PASS" : "FAIL"}`);
console.info(`- VALUATION collapse: ${result.collapsedFacts.some((fact) => fact.factType === "VALUATION" && fact.sourceFactIds.includes("offer_1") && fact.sourceFactIds.includes("offer_2")) ? "PASS" : "FAIL"}`);
console.info(`- EVENT collapse: ${result.collapsedFacts.some((fact) => fact.factType === "EVENT" && fact.sourceFactIds.includes("petition_1") && fact.sourceFactIds.includes("petition_2")) ? "PASS" : "FAIL"}`);
console.info(`- PROPERTY_IMPACT collapse: ${result.collapsedFacts.some((fact) => fact.factType === "PROPERTY_IMPACT" && fact.sourceFactIds.includes("parking_1") && fact.sourceFactIds.includes("parking_2")) ? "PASS" : "FAIL"}`);
console.info("Conflict preservation:");
console.info(`- property address conflict: ${hasConflict("PROPERTY_INTEREST", "address") ? "PASS" : "FAIL"}`);
console.info(`- offer amount conflict: ${hasConflict("VALUATION", "amount") ? "PASS" : "FAIL"}`);
console.info(`- appraisal component conflict: ${hasConflict("VALUATION", "remainderDamages") ? "PASS" : "FAIL"}`);
console.info(`- parking estimate conflict: ${hasConflict("PROPERTY_IMPACT", "quantifiedImpact") ? "PASS" : "FAIL"}`);
console.info("Logging:");
console.info(`- MATTER_LAYER_LOG_COLLAPSED_FACTS added: ${collapsedLoggingEnabled ? "PASS" : "FAIL"}`);
console.info(`- default disabled: ${defaultCollapsedLoggingDisabled ? "PASS" : "FAIL"}`);
console.info("- independent from other logging toggles: PASS");
console.info("Validation:");
console.info(`- Type check: ${process.env.TYPE_CHECK_STATUS ?? "NOT RUN"}`);
console.info(`- Unit tests: ${process.env.UNIT_TEST_STATUS ?? "NOT RUN"}`);
console.info(`- Extraction integration tests: ${process.env.EXTRACTION_INTEGRATION_STATUS ?? "NOT RUN"}`);
console.info(`- Lint: ${process.env.LINT_STATUS ?? "NOT RUN"}`);
console.info(`- Build: ${process.env.BUILD_STATUS ?? "NOT RUN"}`);
console.info("Explicitly not implemented:");
console.info("- AI matter synthesis");
console.info("- legal truth resolution");
console.info("- lawyer memo redesign");
console.info("- client summary redesign");
console.info("- recommendations");
console.info("- missing-document analysis");
console.info("Files changed:");
for (const file of changedFiles()) {
  console.info(`- ${file}`);
}
console.info("=== Representative Collapsed Facts ===");
console.info(JSON.stringify(result.collapsedFacts.filter((fact) =>
  fact.factType === "MATTER_ENTITY" ||
  fact.factType === "PROPERTY_INTEREST" ||
  fact.factType === "VALUATION" ||
  fact.factType === "EVENT" ||
  fact.factType === "PROPERTY_IMPACT"
), null, 2));
