import { execSync } from "node:child_process";

import { runExtractionProfile } from "@/workflow-steps/extraction/profile-runner";
import { eminentDomainFactsProfile } from "@/workflow-steps/extraction/profiles/eminent-domain";
import { eminentDomainCaseAssessmentDefinition } from "@/workflows/eminent-domain-case-assessment.workflow";
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

async function extractFixtureFacts() {
  const result = await runExtractionProfile(eminentDomainFactsProfile, {
    aiService: {
      generateText: async () => ({
        content: JSON.stringify({
          facts: [
            {
              extractionConfidence: "high",
              factType: "MATTER_ENTITY",
              fields: {
                entityType: "property-owner",
                name: "Ramirez Family Holdings, LLC",
              },
              sourceExcerpt: "Ramirez Family Holdings, LLC owns Parcel 14.",
            },
            {
              extractionConfidence: "high",
              factType: "MATTER_ENTITY",
              fields: {
                department: "Transportation and Public Works",
                entityType: "condemning-authority",
                name: "City of Austin",
              },
              sourceExcerpt: "City of Austin Transportation and Public Works Department.",
            },
            {
              extractionConfidence: "high",
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
              extractionConfidence: "high",
              factType: "PROPERTY_INTEREST",
              fields: {
                area: "0.84 acres",
                interestType: "fee-simple",
                parcelNumber: "Parcel 14",
                takingScope: "partial",
              },
              sourceExcerpt: "0.84-acre fee-simple acquisition.",
            },
            {
              extractionConfidence: "high",
              factType: "PROPERTY_INTEREST",
              fields: {
                area: "0.22 acres",
                interestType: "temporary-construction-easement",
                parcelNumber: "Parcel 14",
              },
              sourceExcerpt: "0.22-acre temporary construction easement.",
            },
            {
              extractionConfidence: "high",
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
              extractionConfidence: "medium",
              factType: "VALUATION",
              fields: {
                amount: "$425,000",
                appraiser: "Hill Country Valuation Group",
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
              extractionConfidence: "high",
              factType: "EVENT",
              fields: {
                description: "The City filed the Petition in Condemnation for Parcel 14.",
                eventDate: "2026-03-18",
                eventType: "petition-filed",
                parcelNumber: "Parcel 14",
              },
              sourceExcerpt: "The City filed the Petition in Condemnation for Parcel 14.",
            },
            {
              extractionConfidence: "medium",
              factType: "PROPERTY_IMPACT",
              fields: {
                affectedFeature: "customer parking",
                assertionStatus: "alleged",
                category: "parking",
                description:
                  "The owner alleges that the taking will eliminate approximately 14 parking spaces.",
                parcelNumber: "Parcel 14",
                quantifiedImpact: "approximately 14 parking spaces",
                sourceRole: "owner",
              },
              sourceExcerpt:
                "The owner alleges that the taking will eliminate approximately 14 parking spaces.",
            },
          ],
        }),
        model: "verification-model",
        provider: "fixture",
      }),
    },
    readyDocuments: [
      {
        fileName: "2026-03-18 Petition in Condemnation.pdf",
        id: "doc_petition",
        markdown: [
          '<!-- ml:page {"page":1} -->',
          "Ramirez Family Holdings, LLC owns Parcel 14.",
          "City of Austin Transportation and Public Works Department.",
          '<!-- ml:page {"page":2} -->',
          "Parcel 14 contains 5.60 acres in Travis County.",
          "0.84-acre fee-simple acquisition.",
          "0.22-acre temporary construction easement.",
          '<!-- ml:page {"page":3} -->',
          "final written offer of $435,000",
          "Hill Country Valuation Group valued compensation at $425,000.",
          '<!-- ml:page {"page":4} -->',
          "The City filed the Petition in Condemnation for Parcel 14.",
          "The owner alleges that the taking will eliminate approximately 14 parking spaces.",
        ].join("\n"),
      },
    ],
  });

  if (result.status !== "COMPLETED") {
    throw new Error(result.error ?? "Fixture extraction failed.");
  }

  return result.items as ExtractedFact[];
}

async function extractIntakeFacts() {
  const result = await runExtractionProfile(eminentDomainFactsProfile, {
    aiService: {
      generateText: async () => ({
        content: JSON.stringify({
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
                description:
                  "The intake identifies potential impairment of customer parking from the frontage taking.",
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
                description:
                  "The intake identifies potential impairment of signage visibility from the frontage taking.",
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
                description:
                  "The intake identifies potential impairment of delivery access from the frontage taking.",
                parcelNumber: "Parcel 14",
                sourceRole: "intake",
              },
              sourceExcerpt: "delivery access",
            },
            {
              factType: "PROPERTY_IMPACT",
              fields: {
                category: "parking",
                description: "Confirm whether the appraisal accounts for parking loss.",
              },
              sourceExcerpt: "Confirm whether the appraisal accounts for parking loss.",
            },
          ],
        }),
        model: "verification-model",
        provider: "fixture",
      }),
    },
    readyDocuments: [
      {
        fileName: "2026-04-22 Paralegal Intake Summary.txt",
        id: "doc_intake",
        markdown: [
          "Paralegal intake summary for Parcel 14 eminent-domain matter.",
          "The disputed taking includes frontage area used for customer parking, signage visibility, and delivery access.",
          "Confirm whether the appraisal accounts for parking loss.",
          "Request backup for the condemnor's traffic-control plan.",
          "Collect photos of current driveway usage.",
        ].join("\n"),
      },
    ],
  });

  if (result.status !== "COMPLETED") {
    throw new Error(result.error ?? "Fixture intake extraction failed.");
  }

  return result.items as ExtractedFact[];
}

async function main() {
  const facts = await extractFixtureFacts();
  const intakeFacts = await extractIntakeFacts();

  console.info("=== Eminent Domain Fact Model Simplification ===");
  console.info("Active fact types:");
  for (const factType of eminentDomainFactsProfile.factDefs.map((factDef) => factDef.factType)) {
    console.info(`- ${factType}`);
  }
  console.info("Removed from active profile:");
  for (const removed of [
    "PROPERTY_OWNER",
    "CONDEMNING_AUTHORITY",
    "PROJECT",
    "SUBJECT_PROPERTY",
    "TAKING",
    "OFFER",
    "APPRAISAL",
    "PROCEDURAL_EVENT",
    "DOCUMENT_REFERENCE",
  ]) {
    console.info(`- ${removed}`);
  }
  console.info("Execution model:");
  console.info("- Fact groups added: NO");
  console.info("- AI calls per Markdown window: 1");
  console.info("- Additional matter-level AI call: NO");
  console.info("Profile:");
  console.info(`- Workflow ID: ${eminentDomainCaseAssessmentDefinition.id}`);
  console.info(`- Extraction profile ID: ${eminentDomainFactsProfile.id}`);
  console.info("Validation:");
  console.info(`- Type check: ${process.env.TYPE_CHECK_STATUS ?? "NOT RUN"}`);
  console.info(`- Unit tests: ${process.env.UNIT_TEST_STATUS ?? "NOT RUN"}`);
  console.info(`- Extraction integration tests: ${process.env.EXTRACTION_INTEGRATION_STATUS ?? "NOT RUN"}`);
  console.info(`- Lint: ${process.env.LINT_STATUS ?? "NOT RUN"}`);
  console.info(`- Build: ${process.env.BUILD_STATUS ?? "NOT RUN"}`);
  console.info("Explicitly not implemented:");
  console.info("- identity rules");
  console.info("- deterministic collapse");
  console.info("- cross-document deduplication");
  console.info("- canonical matter facts");
  console.info("- matter-level AI synthesis");
  console.info("- follow-up-action facts");
  console.info("- lawyer memo redesign");
  console.info("- client summary redesign");
  console.info("Compatibility adapters:");
  console.info("- Legacy profile ID alias: eminent-domain-case-assessment -> eminent-domain-facts");
  console.info("- Legacy lawyer/client work-product composers unchanged pending collapse redesign");
  console.info("Files changed:");
  for (const file of changedFiles()) {
    console.info(`- ${file}`);
  }
  console.info("=== Representative Simplified Eminent Domain Raw Facts ===");
  console.info(JSON.stringify(facts, null, 2));
  console.info("=== Representative Paralegal Intake Raw Facts ===");
  console.info(JSON.stringify(intakeFacts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
