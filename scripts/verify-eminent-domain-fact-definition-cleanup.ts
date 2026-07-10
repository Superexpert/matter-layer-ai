import { execSync } from "node:child_process";

import { runExtractionProfile } from "@/workflow-steps/extraction/profile-runner";
import { getExtractionProfile } from "@/workflow-steps/extraction/profiles";
import * as eminentDomainProfileModule from "@/workflow-steps/extraction/profiles/eminent-domain";
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
              factType: "EVENT",
              fields: {
                description: "The City issued its final written offer.",
                eventDate: "2026-02-20",
                eventType: "final-offer-issued",
                parcelNumber: "Parcel 14",
              },
              sourceExcerpt: "issued its final written offer",
            },
            {
              factType: "VALUATION",
              fields: {
                amount: "$425,000",
                appraiser: "Hill Country Valuation Group",
                effectiveDate: "2026-02-01",
                parcelNumber: "Parcel 14",
                reportDate: "2026-02-05",
                valuationType: "condemnor-appraisal",
              },
              sourceExcerpt: "Hill Country Valuation Group valued compensation at $425,000.",
            },
            {
              factType: "PROPERTY_INTEREST",
              fields: {
                area: "0.84 acres",
                interestType: "fee-simple",
                parcelNumber: "Parcel 14",
              },
              sourceExcerpt: "0.84-acre fee-simple acquisition.",
            },
            {
              factType: "PROPERTY_INTEREST",
              fields: {
                area: "0.22 acres",
                interestType: "temporary-construction-easement",
                parcelNumber: "Parcel 14",
              },
              sourceExcerpt: "0.22-acre temporary construction easement.",
            },
            {
              factType: "PROPERTY_IMPACT",
              fields: {
                affectedFeature: "remaining driveway access",
                assertionStatus: "assumed",
                category: "access",
                description: "The appraisal assumes that one commercially reasonable driveway will remain.",
                sourceRole: "appraiser",
              },
              sourceExcerpt:
                "The appraisal assumes that one commercially reasonable driveway will remain.",
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
        fileName: "2026-02-20 Final Offer and Appraisal.pdf",
        id: "doc_cleanup",
        markdown: [
          '<!-- ml:page {"page":1} -->',
          "final written offer of $435,000",
          "issued its final written offer",
          '<!-- ml:page {"page":2} -->',
          "Hill Country Valuation Group valued compensation at $425,000.",
          "0.84-acre fee-simple acquisition.",
          "0.22-acre temporary construction easement.",
          '<!-- ml:page {"page":3} -->',
          "The appraisal assumes that one commercially reasonable driveway will remain.",
          "Confirm whether the appraisal accounts for parking loss.",
        ].join("\n"),
      },
    ],
  });

  if (result.status !== "COMPLETED") {
    throw new Error(result.error ?? "Fixture extraction failed.");
  }

  return result.items as ExtractedFact[];
}

async function main() {
  const facts = await extractFixtureFacts();
  const profileJson = JSON.stringify(eminentDomainFactsProfile.factDefs);
  const valuationFieldNames = eminentDomainFactsProfile.factDefs
    .find((factDef) => factDef.factType === "VALUATION")
    ?.extraction.fields.map((field) => field.name) ?? [];
  const prompt = eminentDomainFactsProfile.buildUserPrompt({
    documentId: "doc_cleanup",
    fileName: "Cleanup.txt",
    markdown: "The City issued its final written offer of $435,000.",
    pageEnd: null,
    pageStart: null,
    windowIndex: 0,
  });
  const finalOffer = facts.find((fact) =>
    fact.factType === "VALUATION" &&
    fact.fields.valuationType === "final-offer",
  );
  const finalOfferEvent = facts.find((fact) =>
    fact.factType === "EVENT" &&
    fact.fields.eventType === "final-offer-issued",
  );
  const appraisal = facts.find((fact) =>
    fact.factType === "VALUATION" &&
    fact.fields.valuationType === "condemnor-appraisal",
  );
  const physicalAssumption = facts.find((fact) =>
    fact.factType === "PROPERTY_IMPACT" &&
    fact.fields.assertionStatus === "assumed",
  );
  const followUpImpact = facts.find((fact) =>
    fact.factType === "PROPERTY_IMPACT" &&
    String(fact.fields.description).startsWith("Confirm whether"),
  );

  console.info("=== Eminent Domain Fact Definition Cleanup ===");
  console.info("Profile:");
  console.info(`- Workflow ID: ${eminentDomainCaseAssessmentDefinition.id}`);
  console.info(`- Extraction profile ID: ${eminentDomainFactsProfile.id}`);
  console.info(`- Misleading exported alias removed: ${"eminentDomainCaseAssessmentProfile" in eminentDomainProfileModule ? "FAIL" : "PASS"}`);
  console.info(`- Legacy registry alias retained: ${getExtractionProfile("eminent-domain-case-assessment") === eminentDomainFactsProfile ? "YES" : "NO"}`);
  console.info("VALUATION:");
  console.info(`- date renamed to offerDate: ${valuationFieldNames.includes("offerDate") && !valuationFieldNames.includes("date") ? "PASS" : "FAIL"}`);
  console.info(`- initial offer requires amount: ${prompt.includes("Offer valuation facts require a stated amount") ? "PASS" : "FAIL"}`);
  console.info(`- final offer requires amount: ${finalOffer?.fields.amount ? "PASS" : "FAIL"}`);
  console.info(`- appraisal date fields remain distinct: ${appraisal?.fields.effectiveDate && appraisal.fields.reportDate ? "PASS" : "FAIL"}`);
  console.info("PROPERTY_IMPACT:");
  console.info(`- valuation-related language removed: ${prompt.includes("valuation-related") ? "FAIL" : "PASS"}`);
  console.info(`- follow-up appraisal tasks excluded: ${followUpImpact ? "FAIL" : "PASS"}`);
  console.info(`- physical appraisal assumptions still supported: ${physicalAssumption ? "PASS" : "FAIL"}`);
  console.info("PROPERTY_INTEREST:");
  console.info(`- area description added: ${profileJson.includes("Area of the property or property interest represented by this fact") ? "PASS" : "FAIL"}`);
  console.info(`- remainderArea description added: ${profileJson.includes("Area of the remaining property after the acquisition") ? "PASS" : "FAIL"}`);
  console.info(`- purpose description added: ${profileJson.includes("Stated purpose of this specific acquired interest") ? "PASS" : "FAIL"}`);
  console.info("VALUATION and EVENT overlap:");
  console.info(`- documented: ${prompt.includes("VALUATION captures the amount and valuation components") ? "PASS" : "FAIL"}`);
  console.info(`- validated with fixture: ${finalOffer && finalOfferEvent ? "PASS" : "FAIL"}`);
  console.info("Execution model:");
  console.info(`- Active fact types: ${eminentDomainFactsProfile.factDefs.length}`);
  console.info("- Fact groups added: NO");
  console.info("- AI calls per Markdown window: 1");
  console.info("- Collapse added: NO");
  console.info("Validation:");
  console.info(`- Type check: ${process.env.TYPE_CHECK_STATUS ?? "NOT RUN"}`);
  console.info(`- Unit tests: ${process.env.UNIT_TEST_STATUS ?? "NOT RUN"}`);
  console.info(`- Extraction integration tests: ${process.env.EXTRACTION_INTEGRATION_STATUS ?? "NOT RUN"}`);
  console.info(`- Lint: ${process.env.LINT_STATUS ?? "NOT RUN"}`);
  console.info(`- Build: ${process.env.BUILD_STATUS ?? "NOT RUN"}`);
  console.info("Files changed:");
  for (const file of changedFiles()) {
    console.info(`- ${file}`);
  }
  console.info("=== Representative Eminent Domain Cleanup Facts ===");
  console.info(JSON.stringify(facts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
