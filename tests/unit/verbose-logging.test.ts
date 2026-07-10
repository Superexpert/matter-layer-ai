import { afterEach, describe, expect, it, vi } from "vitest";

import { AIService } from "@/services/ai/ai-service";
import type { AIProvider } from "@/services/ai/providers/ai-provider";
import {
  isCollapsedFactLoggingEnabled,
  isExtractedFactLoggingEnabled,
  isVerboseAiLoggingEnabled,
  isVerboseExtractionLoggingEnabled,
  logCollapsedFacts,
  logExtractedFacts,
  logExtractionFactSummary,
  logRejectedExtractedFact,
  parseBooleanEnv,
  verboseAiLog,
  verboseExtractionLog,
} from "@/services/diagnostics/verbose-logging";
import type { ExtractedFact } from "@/workflow-steps/extraction/extracted-fact";
import type { FactDef } from "@/workflow-steps/extraction/fact-def";
import { createFactExtractionProfile } from "@/workflow-steps/extraction/generic-fact-profile";
import { runExtractionProfile } from "@/workflow-steps/extraction/profile-runner";

const originalAiLogging = process.env.MATTER_LAYER_VERBOSE_AI_LOGGING;
const originalExtractionLogging =
  process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING;
const originalExtractedFactLogging =
  process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS;
const originalCollapsedFactLogging =
  process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS;

function setVerboseEnv(input: {
  ai?: string;
  collapsedFacts?: string;
  extraction?: string;
  facts?: string;
}) {
  if (input.ai === undefined) {
    delete process.env.MATTER_LAYER_VERBOSE_AI_LOGGING;
  } else {
    process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = input.ai;
  }

  if (input.extraction === undefined) {
    delete process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING;
  } else {
    process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING = input.extraction;
  }

  if (input.facts === undefined) {
    delete process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS;
  } else {
    process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS = input.facts;
  }

  if (input.collapsedFacts === undefined) {
    delete process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS;
  } else {
    process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS = input.collapsedFacts;
  }
}

afterEach(() => {
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

  if (originalExtractedFactLogging === undefined) {
    delete process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS;
  } else {
    process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS =
      originalExtractedFactLogging;
  }

  if (originalCollapsedFactLogging === undefined) {
    delete process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS;
  } else {
    process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS =
      originalCollapsedFactLogging;
  }

  vi.restoreAllMocks();
});

const sampleFact: ExtractedFact = {
  evidence: {
    documentId: "doc_123",
    documentName: "Offer Letter.pdf",
    excerpt: "Ramirez Family Holdings, LLC",
    pageEnd: 1,
    pageStart: 1,
  },
  extractionConfidence: "high",
  factType: "PROPERTY_OWNER",
  fields: {
    name: "Ramirez Family Holdings, LLC",
  },
  id: "fact_123",
};

describe("parseBooleanEnv", () => {
  it("returns the default for missing, empty, and unrecognized values", () => {
    expect(parseBooleanEnv(undefined, true)).toBe(true);
    expect(parseBooleanEnv("   ", true)).toBe(true);
    expect(parseBooleanEnv("unexpected", true)).toBe(true);
    expect(parseBooleanEnv("unexpected", false)).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes", "on"])(
    "enables %s",
    (value) => {
      expect(parseBooleanEnv(value)).toBe(true);
    },
  );

  it.each(["false", "0", "no", "off"])(
    "disables %s",
    (value) => {
      expect(parseBooleanEnv(value, true)).toBe(false);
    },
  );
});

describe("verbose logging categories", () => {
  it("suppresses AI verbose logs when AI logging is disabled", () => {
    setVerboseEnv({ ai: "false", extraction: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseAiLog("[ai:generateText]", "request completed", {
      model: "test-model",
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits AI verbose logs when AI logging is enabled", () => {
    setVerboseEnv({ ai: "true", extraction: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseAiLog("[ai:generateText]", "request completed", {
      model: "test-model",
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[ai:generateText] request completed",
      { model: "test-model" },
    );
  });

  it("suppresses Extraction verbose logs when Extraction logging is disabled", () => {
    setVerboseEnv({ ai: "false", extraction: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseExtractionLog("[extraction:service]", "document result merged", {
      itemCount: 1,
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits Extraction verbose logs when Extraction logging is enabled", () => {
    setVerboseEnv({ ai: "false", extraction: "true" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseExtractionLog("[extraction:service]", "document result merged", {
      itemCount: 1,
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[extraction:service] document result merged",
      { itemCount: 1 },
    );
  });

  it("does not let AI logging enable Extraction logging", () => {
    setVerboseEnv({ ai: "on", extraction: "off" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseAiLog("[ai:generateText]", "request completed");
    verboseExtractionLog("[extraction:service]", "document result merged");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[ai:generateText] request completed");
  });

  it("does not let Extraction logging enable AI logging", () => {
    setVerboseEnv({ ai: "off", extraction: "yes" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseAiLog("[ai:generateText]", "request completed");
    verboseExtractionLog("[extraction:service]", "document result merged");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "[extraction:service] document result merged",
    );
  });

  it("logs both categories when both toggles are enabled", () => {
    setVerboseEnv({ ai: "1", extraction: "1" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseAiLog("[ai:generateText]", "request completed");
    verboseExtractionLog("[extraction:service]", "document result merged");

    expect(logSpy).toHaveBeenCalledWith("[ai:generateText] request completed");
    expect(logSpy).toHaveBeenCalledWith(
      "[extraction:service] document result merged",
    );
  });

  it("keeps AI request errors visible when both verbose toggles are disabled", async () => {
    setVerboseEnv({ ai: "false", extraction: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider: AIProvider = {
      generateText: async () => {
        throw new Error("provider unavailable");
      },
      name: "test-provider",
      streamText: async function* () {
        yield {
          error: "provider unavailable",
          type: "error",
        };
      },
    };

    await expect(
      new AIService(provider).generateText({
        messages: [
          {
            content: "Hello",
            role: "user",
          },
        ],
      }),
    ).rejects.toThrow("provider unavailable");

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[ai:generateText] request failed",
      expect.objectContaining({
        errorMessage: "provider unavailable",
      }),
    );
  });
});

describe("extracted fact logging", () => {
  it("is disabled when missing or explicitly false", () => {
    setVerboseEnv({});
    expect(isExtractedFactLoggingEnabled()).toBe(false);

    setVerboseEnv({ facts: "false" });
    expect(isExtractedFactLoggingEnabled()).toBe(false);
  });

  it.each(["true", "1", "yes", "on"])(
    "is enabled for %s",
    (value) => {
      setVerboseEnv({ facts: value });

      expect(isExtractedFactLoggingEnabled()).toBe(true);
    },
  );

  it("does not call console.log when disabled", () => {
    setVerboseEnv({ facts: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logExtractedFacts({
      documentId: "doc_123",
      documentName: "Offer Letter.pdf",
      profileId: "eminent-domain-facts",
      status: "COMPLETED",
    }, [sampleFact]);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("prints document metadata and pretty-printed facts when enabled", () => {
    setVerboseEnv({ facts: "true" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logExtractedFacts({
      completedWindowCount: 1,
      documentId: "doc_123",
      documentName: "Offer Letter.pdf",
      failedWindowCount: 0,
      profileId: "eminent-domain-facts",
      status: "COMPLETED",
    }, [sampleFact]);

    expect(logSpy).toHaveBeenCalledWith("=== Extracted Facts ===");
    expect(logSpy).toHaveBeenCalledWith("Document: Offer Letter.pdf");
    expect(logSpy).toHaveBeenCalledWith("Document ID: doc_123");
    expect(logSpy).toHaveBeenCalledWith(
      "Profile: eminent-domain-facts",
    );
    expect(logSpy).toHaveBeenCalledWith("Status: COMPLETED");
    expect(logSpy).toHaveBeenCalledWith("Completed windows: 1");
    expect(logSpy).toHaveBeenCalledWith("Failed windows: 0");
    expect(logSpy).toHaveBeenCalledWith("Fact count: 1");
    expect(logSpy).toHaveBeenCalledWith("Facts:");
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify([sampleFact], null, 2));
    expect(logSpy).toHaveBeenCalledWith("=== End Extracted Facts ===");
  });

  it("prints zero-fact documents when enabled", () => {
    setVerboseEnv({ facts: "true" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logExtractedFacts({
      documentId: "doc_empty",
      documentName: "Empty.txt",
      profileId: "eminent-domain-facts",
      status: "COMPLETED",
    }, []);

    expect(logSpy).toHaveBeenCalledWith("Fact count: 0");
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify([], null, 2));
  });

  it("prints valid facts from a partially failed document", () => {
    setVerboseEnv({ facts: "true" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logExtractedFacts({
      completedWindowCount: 2,
      documentId: "doc_partial",
      documentName: "Partial.pdf",
      failedWindowCount: 1,
      profileId: "eminent-domain-facts",
      status: "PARTIAL_FAILED",
    }, [sampleFact]);

    expect(logSpy).toHaveBeenCalledWith("Status: PARTIAL_FAILED");
    expect(logSpy).toHaveBeenCalledWith("Completed windows: 2");
    expect(logSpy).toHaveBeenCalledWith("Failed windows: 1");
    expect(logSpy).toHaveBeenCalledWith("Fact count: 1");
  });

  it("prints final summary counts by fact type", () => {
    setVerboseEnv({ facts: "true" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logExtractionFactSummary({
      completedDocumentCount: 2,
      failedDocumentCount: 1,
      factsByType: {
        OFFER: 2,
        PROPERTY_OWNER: 1,
      },
      profileId: "eminent-domain-facts",
      totalFactCount: 3,
      workflowRunId: "run_123",
    });

    expect(logSpy).toHaveBeenCalledWith("=== Extraction Fact Summary ===");
    expect(logSpy).toHaveBeenCalledWith("Workflow run: run_123");
    expect(logSpy).toHaveBeenCalledWith("Documents completed: 2");
    expect(logSpy).toHaveBeenCalledWith("Documents failed: 1");
    expect(logSpy).toHaveBeenCalledWith("Total valid facts: 3");
    expect(logSpy).toHaveBeenCalledWith("- PROPERTY_OWNER: 1");
    expect(logSpy).toHaveBeenCalledWith("- OFFER: 2");
  });

  it("does not imply AI or Extraction verbose logging", () => {
    setVerboseEnv({ ai: "false", extraction: "false", facts: "true" });

    expect(isExtractedFactLoggingEnabled()).toBe(true);
    expect(isVerboseAiLoggingEnabled()).toBe(false);
    expect(isVerboseExtractionLoggingEnabled()).toBe(false);
  });

  it("Extraction verbose logging does not print facts when fact logging is disabled", () => {
    setVerboseEnv({ extraction: "true", facts: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseExtractionLog("[extraction:service]", "document result merged");
    logExtractedFacts({
      documentId: "doc_123",
      documentName: "Offer Letter.pdf",
      profileId: "eminent-domain-facts",
      status: "COMPLETED",
    }, [sampleFact]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "[extraction:service] document result merged",
    );
  });

  it("AI verbose logging does not print facts when fact logging is disabled", () => {
    setVerboseEnv({ ai: "true", facts: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verboseAiLog("[ai:generateText]", "request completed");
    logExtractedFacts({
      documentId: "doc_123",
      documentName: "Offer Letter.pdf",
      profileId: "eminent-domain-facts",
      status: "COMPLETED",
    }, [sampleFact]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[ai:generateText] request completed");
  });

  it("prints collapsed facts only when collapsed fact logging is enabled", () => {
    setVerboseEnv({ collapsedFacts: "false" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const collapsedFacts = [
      {
        conflicts: [],
        evidence: [sampleFact.evidence],
        factType: "MATTER_ENTITY",
        fields: {
          entityType: "property-owner",
          name: "Ramirez Family Holdings, LLC",
        },
        id: "collapsed_123",
        identity: {
          matchedFields: ["entityType", "name"],
          ruleIndex: 0,
          strategy: "multiKey",
        },
        identityKey: "owner-key",
        sourceFactIds: [sampleFact.id],
        status: "resolved" as const,
      },
    ];
    const summary = {
      collapsedFactCount: 1,
      conflictingCount: 0,
      countsByFactType: {
        MATTER_ENTITY: {
          collapsed: 1,
          conflicting: 0,
          raw: 1,
        },
      },
      rawFactCount: 1,
      resolvedCount: 1,
      uncollapsedCount: 0,
    };

    logCollapsedFacts({
      collapsedFacts,
      profileId: "eminent-domain-facts",
      summary,
    });
    expect(logSpy).not.toHaveBeenCalled();

    setVerboseEnv({ collapsedFacts: "true" });
    logCollapsedFacts({
      collapsedFacts,
      profileId: "eminent-domain-facts",
      summary,
    });

    expect(logSpy).toHaveBeenCalledWith("=== Collapsed Facts ===");
    expect(logSpy).toHaveBeenCalledWith("Profile: eminent-domain-facts");
    expect(logSpy).toHaveBeenCalledWith("Raw fact count: 1");
    expect(logSpy).toHaveBeenCalledWith("Collapsed fact count: 1");
    expect(logSpy).toHaveBeenCalledWith("- MATTER_ENTITY: raw=1, collapsed=1, conflicting=0");
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(collapsedFacts, null, 2));
  });

  it("collapsed fact logging is independent from AI, extraction, and raw fact logs", () => {
    setVerboseEnv({
      ai: "false",
      collapsedFacts: "true",
      extraction: "false",
      facts: "false",
    });

    expect(isCollapsedFactLoggingEnabled()).toBe(true);
    expect(isExtractedFactLoggingEnabled()).toBe(false);
    expect(isVerboseAiLoggingEnabled()).toBe(false);
    expect(isVerboseExtractionLoggingEnabled()).toBe(false);
  });

  it("prints rejected fact diagnostics with validation reasons", () => {
    setVerboseEnv({ facts: "true" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const candidate = {
      factType: "OFFER",
      fields: {
        offerType: "final",
      },
    };

    logRejectedExtractedFact({
      candidate,
      documentName: "Petition.pdf",
      factType: "OFFER",
      reason: "Fact field amount is required.",
      windowCount: 2,
      windowIndex: 2,
    });

    expect(warnSpy).toHaveBeenCalledWith("=== Rejected Extracted Fact ===");
    expect(warnSpy).toHaveBeenCalledWith("Document: Petition.pdf");
    expect(warnSpy).toHaveBeenCalledWith("Window: 2 of 2");
    expect(warnSpy).toHaveBeenCalledWith("Fact type: OFFER");
    expect(warnSpy).toHaveBeenCalledWith("Reason: Fact field amount is required.");
    expect(warnSpy).toHaveBeenCalledWith(JSON.stringify(candidate, null, 2));
  });

  it("does not alter extraction results when fact logging is enabled", async () => {
    const factDefs = [
      {
        extraction: {
          fields: [
            {
              name: "name",
              required: true,
              type: "string",
            },
          ],
          instructions: "Extract stated owners.",
        },
        factType: "PROPERTY_OWNER",
      },
    ] satisfies FactDef[];
    const profile = createFactExtractionProfile({
      factDefs,
      id: "test-facts",
      label: "Test Facts",
    });
    const aiService = {
      generateText: async () => ({
        content: JSON.stringify({
          facts: [
            {
              factType: "PROPERTY_OWNER",
              fields: {
                name: "Ramirez Family Holdings, LLC",
              },
              id: "fact_stable",
              sourceExcerpt: "Ramirez Family Holdings, LLC",
            },
          ],
        }),
        model: "test-model",
        provider: "test-provider",
      }),
    };
    const readyDocuments = [
      {
        fileName: "Owner.txt",
        id: "doc_owner",
        markdown: "Ramirez Family Holdings, LLC",
      },
    ];

    setVerboseEnv({ facts: "false" });
    const disabledResult = await runExtractionProfile(profile, {
      aiService,
      readyDocuments,
    });

    setVerboseEnv({ facts: "true" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const enabledResult = await runExtractionProfile(profile, {
      aiService,
      readyDocuments,
    });

    expect(enabledResult.items).toEqual(disabledResult.items);
    expect(enabledResult.itemCountsByType).toEqual(
      disabledResult.itemCountsByType,
    );
    expect(enabledResult.status).toBe(disabledResult.status);
  });
});
