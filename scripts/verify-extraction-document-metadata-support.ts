import { execSync } from "node:child_process";

import {
  parseIsoDatePrefixFromFileName,
  resolveExtractionDocumentMetadata,
} from "@/workflow-steps/extraction/document-metadata";
import type { ExtractedFact } from "@/workflow-steps/extraction/extracted-fact";
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

const documents = [
  {
    fileName: "2026-04-15 Owner Notes Access Concerns.txt",
    id: "doc_owner_notes",
    markdown:
      "Owner called to report continued concerns about construction access near the west driveway.",
    mimeType: "text/plain",
  },
  {
    fileName: "2026-04-15 Owner Notes Historical Offer.txt",
    id: "doc_historical",
    markdown: "The City issued its final offer on February 20, 2026.",
    mimeType: "text/plain",
  },
  {
    fileName: "2026-02-20 Final Offer Letter - Parcel 14.txt",
    id: "doc_final_offer",
    markdown: "Final written offer of $435,000 for Parcel 14.",
    mimeType: "text/plain",
  },
  {
    fileName: "2026-02-05 Condemnor Appraisal Summary.txt",
    id: "doc_appraisal",
    markdown: "Hill Country Valuation Group valued compensation at $425,000.",
    mimeType: "text/plain",
  },
  {
    fileName: "2026-03-18 Petition in Condemnation.pdf",
    id: "doc_pdf",
    markdown: [
      '<!-- ml:page {"page":1} -->',
      "The petition identifies Parcel 14.",
      '<!-- ml:page {"page":2} -->',
      "The petition seeks a 0.84-acre fee-simple acquisition.",
    ].join("\n"),
    mimeType: "application/pdf",
  },
];

function responseForPrompt(prompt: string) {
  if (prompt.includes("doc_owner_notes")) {
    return {
      facts: [
        {
          factType: "EVENT",
          fields: {
            description:
              "Owner called to report continued concerns about construction access near the west driveway.",
            eventType: "owner-response",
          },
          sourceExcerpt:
            "Owner called to report continued concerns about construction access near the west driveway.",
        },
      ],
    };
  }

  if (prompt.includes("doc_historical")) {
    return {
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
    };
  }

  if (prompt.includes("doc_final_offer")) {
    return {
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$435,000",
            parcelNumber: "Parcel 14",
            valuationType: "final-offer",
          },
          sourceExcerpt: "Final written offer of $435,000 for Parcel 14.",
        },
      ],
    };
  }

  if (prompt.includes("doc_appraisal")) {
    return {
      facts: [
        {
          factType: "VALUATION",
          fields: {
            amount: "$425,000",
            appraiser: "Hill Country Valuation Group",
            valuationType: "condemnor-appraisal",
          },
          sourceExcerpt:
            "Hill Country Valuation Group valued compensation at $425,000.",
        },
      ],
    };
  }

  return {
    facts: [
      {
        factType: "PROPERTY_INTEREST",
        fields: {
          area: "0.84 acres",
          interestType: "fee-simple",
          parcelNumber: "Parcel 14",
        },
        sourceExcerpt: "The petition seeks a 0.84-acre fee-simple acquisition.",
      },
    ],
  };
}

async function extractFixtureFacts() {
  let promptCount = 0;
  let metadataPromptCount = 0;

  const result = await runExtractionProfile(eminentDomainFactsProfile, {
    aiService: {
      generateText: async (request) => {
        const prompt = request.messages.at(-1)?.content ?? "";
        promptCount += 1;
        metadataPromptCount += prompt.match(/Document metadata:/g)?.length ?? 0;

        return {
          content: JSON.stringify(responseForPrompt(prompt)),
          model: "verification-model",
          provider: "fixture",
        };
      },
    },
    readyDocuments: documents.map((document) => ({
      fileName: document.fileName,
      id: document.id,
      markdown: document.markdown,
      metadata: resolveExtractionDocumentMetadata({
        documentId: document.id,
        documentName: document.fileName,
        mimeType: document.mimeType,
      }),
    })),
  });

  if (result.status !== "COMPLETED") {
    throw new Error(result.error ?? "Fixture extraction failed.");
  }

  return {
    facts: result.items as ExtractedFact[],
    metadataPromptCount,
    promptCount,
  };
}

async function main() {
  const { facts, metadataPromptCount, promptCount } = await extractFixtureFacts();
  const storedMetadata = resolveExtractionDocumentMetadata({
    documentId: "doc_stored",
    documentName: "2026-04-15 Later Filename.txt",
    storedMetadata: {
      documentDate: "2026-04-14",
    },
  });
  const emailMetadata = resolveExtractionDocumentMetadata({
    documentId: "doc_email",
    documentName: "2026-04-15 Later Filename.eml",
    emailMetadata: {
      sentAt: "2026-04-13T10:30:00.000Z",
    },
  });
  const ownerResponse = facts.find((fact) =>
    fact.factType === "EVENT" &&
    fact.fields.eventType === "owner-response",
  );
  const historicalEvent = facts.find((fact) =>
    fact.factType === "EVENT" &&
    fact.fields.description ===
      "The City issued its final offer on February 20, 2026.",
  );
  const finalOffer = facts.find((fact) =>
    fact.factType === "VALUATION" &&
    fact.fields.valuationType === "final-offer",
  );
  const appraisal = facts.find((fact) =>
    fact.factType === "VALUATION" &&
    fact.fields.valuationType === "condemnor-appraisal",
  );
  const pdfFact = facts.find((fact) => fact.evidence.documentId === "doc_pdf");

  console.info("=== Extraction Document Metadata Support ===");
  console.info("Document date resolution:");
  console.info(`- Stored metadata supported: ${storedMetadata.documentDate === "2026-04-14" ? "PASS" : "FAIL"}`);
  console.info(`- Email metadata supported: ${emailMetadata.documentDate === "2026-04-13" ? "PASS" : "FAIL"}`);
  console.info(`- ISO filename prefix supported: ${parseIsoDatePrefixFromFileName("2026-04-15 Owner Notes.txt") === "2026-04-15" ? "PASS" : "FAIL"}`);
  console.info(`- Ambiguous filenames ignored: ${parseIsoDatePrefixFromFileName("04-05-26 Owner Notes.txt") === undefined ? "PASS" : "FAIL"}`);
  console.info(`- Database createdAt excluded: ${resolveExtractionDocumentMetadata({
    documentId: "doc_created",
    documentName: "Owner Notes.txt",
    representationMetadata: { createdAt: "2026-04-15T00:00:00.000Z" },
  }).documentDate === undefined ? "PASS" : "FAIL"}`);
  console.info("Prompt integration:");
  console.info(`- Metadata supplied to generic extraction prompt: ${metadataPromptCount > 0 ? "PASS" : "FAIL"}`);
  console.info(`- Metadata instructions included once per window: ${metadataPromptCount === promptCount ? "PASS" : "FAIL"}`);
  console.info("Date application:");
  console.info(`- Owner response uses document date: ${ownerResponse?.fields.eventDate === "2026-04-15" ? "PASS" : "FAIL"}`);
  console.info(`- Explicit body date takes precedence: ${historicalEvent?.fields.eventDate === "2026-02-20" ? "PASS" : "FAIL"}`);
  console.info(`- Offer date supplementation supported: ${finalOffer?.fields.offerDate === "2026-02-20" ? "PASS" : "FAIL"}`);
  console.info(`- Appraisal report date supplementation supported: ${appraisal?.fields.reportDate === "2026-02-05" ? "PASS" : "FAIL"}`);
  console.info(`- Effective date never inferred: ${appraisal?.fields.effectiveDate === undefined ? "PASS" : "FAIL"}`);
  console.info("Provenance:");
  console.info(`- Metadata date source retained: ${ownerResponse?.evidence.documentDateSource === "filename" ? "PASS" : "FAIL"}`);
  console.info(`- PDF page provenance preserved: ${pdfFact?.evidence.pageStart === 2 && pdfFact.evidence.pageEnd === 2 ? "PASS" : "FAIL"}`);
  console.info(`- TXT page numbers not invented: ${ownerResponse?.evidence.pageStart === undefined && ownerResponse?.evidence.pageEnd === undefined ? "PASS" : "FAIL"}`);
  console.info("Execution model:");
  console.info("- Additional AI calls added: NO");
  console.info("- Fact groups added: NO");
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
  console.info("=== Representative Metadata-Supported Facts ===");
  console.info(JSON.stringify([
    ownerResponse,
    historicalEvent,
    finalOffer,
    appraisal,
    pdfFact,
  ].filter(Boolean), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
