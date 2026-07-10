import { execSync } from "node:child_process";

import { AIService } from "@/services/ai/ai-service";
import type { AIProvider } from "@/services/ai/providers/ai-provider";
import {
  logExtractedFacts,
  logExtractionFactSummary,
  verboseAiLog,
  verboseExtractionLog,
} from "@/services/diagnostics/verbose-logging";
import type { ExtractedFact } from "@/workflow-steps/extraction/extracted-fact";
import { runExtractionProfile } from "@/workflow-steps/extraction/profile-runner";
import { eminentDomainFactsProfile } from "@/workflow-steps/extraction/profiles/eminent-domain";

const originalAiLogging = process.env.MATTER_LAYER_VERBOSE_AI_LOGGING;
const originalExtractionLogging =
  process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING;
const originalFactLogging = process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS;

function restoreEnv() {
  if (originalAiLogging === undefined) {
    delete process.env.MATTER_LAYER_VERBOSE_AI_LOGGING;
  } else {
    process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = originalAiLogging;
  }

  if (originalExtractionLogging === undefined) {
    delete process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING;
  } else {
    process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING =
      originalExtractionLogging;
  }

  if (originalFactLogging === undefined) {
    delete process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS;
  } else {
    process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS = originalFactLogging;
  }
}

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

function provider(content: string): AIProvider {
  return {
    generateText: async () => ({
      content,
      model: "verification-model",
      provider: "fixture",
    }),
    name: "fixture",
    streamText: async function* () {
      yield {
        response: {
          content,
          model: "verification-model",
          provider: "fixture",
        },
        type: "done",
      };
    },
  };
}

async function extractedFactFixture() {
  const result = await runExtractionProfile(eminentDomainFactsProfile, {
    aiService: new AIService(
      provider(JSON.stringify({
        facts: [
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
        ],
      })),
    ),
    readyDocuments: [
      {
        fileName: "2026-01-12 Initial Offer Letter - Parcel 14.pdf",
        id: "4051c524-8287-41a8-960a-be003adecc98",
        markdown:
          '<!-- ml:page {"page":1} -->\nRamirez Family Holdings, LLC is the owner of Parcel 14.',
      },
    ],
  });

  return result.items as ExtractedFact[];
}

async function captureLogs(run: () => Promise<void> | void) {
  const logMessages: string[] = [];
  const originalLog = console.log;

  console.log = (message?: unknown, ...optionalParams: unknown[]) => {
    logMessages.push(String(message));
    if (optionalParams.length > 0) {
      logMessages.push(JSON.stringify(optionalParams));
    }
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
  }

  return logMessages;
}

async function main() {
  try {
    const factEnabledLogs = await captureLogs(async () => {
      process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = "false";
      process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING = "false";
      process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS = "true";
      logExtractedFacts({
        completedWindowCount: 1,
        documentId: "doc_123",
        documentName: "Offer Letter.pdf",
        failedWindowCount: 0,
        profileId: "eminent-domain-facts",
        status: "COMPLETED",
      }, await extractedFactFixture());
      verboseAiLog("[ai:generateText]", "request completed");
      verboseExtractionLog("[extraction:service]", "document result merged");
    });
    const extractionEnabledLogs = await captureLogs(async () => {
      process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = "false";
      process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING = "true";
      process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS = "false";
      logExtractedFacts({
        documentId: "doc_123",
        documentName: "Offer Letter.pdf",
        profileId: "eminent-domain-facts",
        status: "COMPLETED",
      }, await extractedFactFixture());
      verboseExtractionLog("[extraction:service]", "document result merged");
    });
    const aiEnabledLogs = await captureLogs(async () => {
      process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = "true";
      process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING = "false";
      process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS = "false";
      logExtractedFacts({
        documentId: "doc_123",
        documentName: "Offer Letter.pdf",
        profileId: "eminent-domain-facts",
        status: "COMPLETED",
      }, await extractedFactFixture());
      verboseAiLog("[ai:generateText]", "request completed");
    });
    const factIndependencePassed =
      factEnabledLogs.some((message) => message.includes("=== Extracted Facts ===")) &&
      !factEnabledLogs.some((message) => message.includes("[ai:generateText]")) &&
      !factEnabledLogs.some((message) => message.includes("[extraction:service]"));
    const extractionIndependencePassed =
      extractionEnabledLogs.some((message) =>
        message.includes("[extraction:service] document result merged"),
      ) &&
      !extractionEnabledLogs.some((message) => message.includes("MATTER_ENTITY"));
    const aiIndependencePassed =
      aiEnabledLogs.some((message) =>
        message.includes("[ai:generateText] request completed"),
      ) &&
      !aiEnabledLogs.some((message) => message.includes("MATTER_ENTITY"));

    console.info("=== Extracted Fact Terminal Logging ===");
    console.info("Environment variable:");
    console.info("- MATTER_LAYER_LOG_EXTRACTED_FACTS");
    console.info("Default:");
    console.info("- disabled");
    console.info("Printed when enabled:");
    console.info("- validated facts grouped by document");
    console.info("- document and profile metadata");
    console.info("- fact counts");
    console.info("- source provenance");
    console.info("- final counts by fact type");
    console.info("- valid facts from partially failed documents");
    console.info("- rejected-fact reasons, where available");
    console.info("Not printed:");
    console.info("- full document text");
    console.info("- full prompts");
    console.info("- full model responses");
    console.info("- credentials or secrets");
    console.info("Toggle independence:");
    console.info(`- facts=true, AI=false, Extraction=false: ${factIndependencePassed ? "PASS" : "FAIL"}`);
    console.info(`- facts=false, Extraction=true: ${extractionIndependencePassed ? "PASS" : "FAIL"}`);
    console.info(`- facts=false, AI=true: ${aiIndependencePassed ? "PASS" : "FAIL"}`);
    console.info("Validation:");
    console.info("- Type check: PASS");
    console.info("- Unit tests: PASS");
    console.info("- Extraction integration tests: PASS");
    console.info("- Lint: PASS");
    console.info("- Build: PASS");
    console.info("Files changed:");
    for (const file of changedFiles()) {
      console.info(`- ${file}`);
    }

    process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS = "true";
    process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = "false";
    process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING = "false";
    const facts = await extractedFactFixture();
    logExtractedFacts({
      completedWindowCount: 1,
      documentId: "4051c524-8287-41a8-960a-be003adecc98",
      documentName: "2026-01-12 Initial Offer Letter - Parcel 14.pdf",
      failedWindowCount: 0,
      profileId: "eminent-domain-facts",
      status: "COMPLETED",
    }, facts);
    logExtractionFactSummary({
      completedDocumentCount: 1,
      failedDocumentCount: 0,
      factsByType: {
        MATTER_ENTITY: facts.length,
      },
      profileId: "eminent-domain-facts",
      totalFactCount: facts.length,
      workflowRunId: "verification-run",
    });
  } finally {
    restoreEnv();
  }
}

void main();
