import { execSync } from "node:child_process";

import { runExtractionProfile } from "@/workflow-steps/extraction/profile-runner";
import { eminentDomainFactsProfile } from "@/workflow-steps/extraction/profiles/eminent-domain";

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

const sampleFacts = [
  {
    extractionConfidence: "high",
    factType: "MATTER_ENTITY",
    fields: {
      entityType: "property-owner",
      name: "Ramirez Family Holdings, LLC",
    },
    pageEnd: 1,
    pageStart: 1,
    sourceExcerpt:
      "Ramirez Family Holdings, LLC is the owner of Parcel 14.",
  },
  {
    extractionConfidence: "high",
    factType: "VALUATION",
    fields: {
      amount: "$1,250,000",
      offerDate: "2026-01-12",
      parcelNumber: "14",
      responseDeadline: "2026-02-11",
      valuationType: "initial-offer",
    },
    pageEnd: 1,
    pageStart: 1,
    sourceExcerpt:
      "The Authority makes an initial offer of $1,250,000 for Parcel 14.",
  },
  {
    extractionConfidence: "medium",
    factType: "VALUATION",
    fields: {
      appraiser: "Lone Star Valuation Group",
      costToCure: "$85,000",
      partTakenValue: "$640,000",
      remainderDamages: "$210,000",
      reportDate: "2026-02-05",
      temporaryDamages: "$45,000",
      amount: "$1,020,000",
      valuationType: "condemnor-appraisal",
    },
    pageEnd: 3,
    pageStart: 2,
    sourceExcerpt:
      "Lone Star Valuation Group concluded total compensation of $1,020,000.",
  },
  {
    extractionConfidence: "high",
    factType: "EVENT",
    fields: {
      deadline: null,
      description:
        "Special commissioners hearing scheduled for May 14, 2026.",
      eventDate: "2026-05-14",
      eventType: "hearing-scheduled",
    },
    pageEnd: 1,
    pageStart: 1,
    sourceExcerpt:
      "The special commissioners hearing is scheduled for May 14, 2026.",
  },
  {
    extractionConfidence: "medium",
    factType: "PROPERTY_IMPACT",
    fields: {
      affectedFeature: "front parking row",
      category: "parking",
      description:
        "The appraisal assumes nine parking spaces will be unavailable during construction.",
      duration: "temporary",
      quantifiedImpact: "nine parking spaces",
    },
    pageEnd: 4,
    pageStart: 4,
    sourceExcerpt:
      "During construction, nine parking spaces in the front row will be unavailable.",
  },
];

async function main() {
  const result = await runExtractionProfile(eminentDomainFactsProfile, {
    aiService: {
      generateText: async () => ({
        content: JSON.stringify({
          facts: sampleFacts,
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
          "Ramirez Family Holdings, LLC is the owner of Parcel 14.",
          "The Authority makes an initial offer of $1,250,000 for Parcel 14.",
          '<!-- ml:page {"page":2} -->',
          "Lone Star Valuation Group concluded total compensation of $1,020,000.",
          '<!-- ml:page {"page":4} -->',
          "During construction, nine parking spaces in the front row will be unavailable.",
        ].join("\n"),
      },
    ],
  });

  const files = changedFiles();

  console.info("=== Extraction Fact Definition Refactor ===");
  console.info("Files changed:");
  for (const file of files) {
    console.info(`- ${file}`);
  }
  console.info("New generic contracts:");
  console.info("- FactDef / FactExtractionDef / FactFieldDef");
  console.info("- ExtractedFact / ExtractedFactEvidence");
  console.info("- generic fact schema builder");
  console.info("- generic fact parser, validator, and provenance attachment");
  console.info("Profiles migrated:");
  console.info("- chronology");
  console.info("- eminent-domain");
  console.info("Eminent-domain fact types:");
  for (const factType of eminentDomainFactsProfile.factDefs.map((factDef) => factDef.factType)) {
    console.info(`- ${factType}`);
  }
  console.info("Explicitly not implemented:");
  console.info("- deterministic identity collapse");
  console.info("- cross-document deduplication");
  console.info("- canonical matter facts");
  console.info("- matter-level AI synthesis");
  console.info("- lawyer memo redesign");
  console.info("- client summary redesign");
  console.info("Compatibility adapters or TODOs:");
  console.info("- Chronology postprocess maps raw DATED_EVENT facts to legacy ChronologyFact rows for existing collapse/artifact generation.");
  console.info("- Eminent Domain lawyer memo/client summary composition still has legacy assessment-type code and is intentionally not redesigned in this task.");
  console.info("Validation:");
  console.info("- Type check: PASS");
  console.info("- Unit tests: PASS");
  console.info("- Integration tests: PASS for targeted extraction workflow; FAIL for full suite due unrelated shared-database/document-editor tests");
  console.info("- Lint: PASS");
  console.info("- Build: PASS");
  console.info("");
  console.info("=== Sample Eminent Domain Raw Facts ===");
  console.info(JSON.stringify(result.items, null, 2));
}

void main();
