import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  PrismaClient,
  WorkflowExtractionRunStatus,
} from "@prisma/client";
import { afterAll, expect, test } from "vitest";

import type { WorkflowStepDefinition } from "../../services/workflows/types";
import { saveFileSelectorStepSelection } from "../../workflow-steps/file-selector/server";
import { defaultFileSelectorConfig } from "../../workflow-steps/file-selector/schema";
import { uploadMatterDocuments } from "../../workflow-steps/file-selector/server";
import {
  loadExtractionStepState,
  runExtractionStep,
  type RunExtractionStepInput,
} from "../../workflow-steps/extraction/server";
import { extractionStep as registeredExtractionStep } from "../../workflow-steps/extraction/definition";
import { runExtractionProfile } from "../../workflow-steps/extraction/profile-runner";
import { chronologyRunnerProfile } from "../../workflow-steps/extraction/profiles/chronology/extractor";
import { eminentDomainFactsProfile } from "../../workflow-steps/extraction/profiles/eminent-domain";

const prisma = new PrismaClient();

type MockAIService = NonNullable<RunExtractionStepInput["aiService"]> & {
  readonly callCount: number;
};
type MockGenerateTextRequest = Parameters<MockAIService["generateText"]>[0];
type MockGenerateTextResponse = Awaited<ReturnType<MockAIService["generateText"]>>;

afterAll(async () => {
  await prisma.$disconnect();
});

const extractionStep: WorkflowStepDefinition = {
  description: "Convert the selected documents into AI-readable Markdown for chronology extraction.",
  id: "extract-chronology",
  name: "Prepare source documents",
  parameters: {
    inputStepId: "select-source-files",
    profile: "chronology",
    representationType: "MARKDOWN",
  },
  type: "extraction",
};

async function createUserAndMatter() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `extraction-${suffix}@example.com`,
      name: "Extraction Lawyer",
    },
  });
  const matter = await prisma.matter.create({
    data: {
      name: `Extraction Matter ${suffix}`,
    },
  });

  return {
    matter,
    user,
  };
}

async function cleanupMatter(matterId: string) {
  await prisma.workflowArtifact.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.workflowRunStepActivity.deleteMany({
    where: {
      workflowRun: {
        matterId,
      },
    },
  });
  await prisma.workflowRunStepFile.deleteMany({
    where: {
      workflowRun: {
        matterId,
      },
    },
  });
  await prisma.workflowRunStepOutput.deleteMany({
    where: {
      workflowRun: {
        matterId,
      },
    },
  });
  await prisma.workflowExtractionRun.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.workflowRun.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.matterDocumentRepresentation.deleteMany({
    where: {
      document: {
        matterId,
      },
    },
  });
  await prisma.matterDocument.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.matter.delete({
    where: {
      id: matterId,
    },
  });
}

async function uploadFixture(input: {
  bytes: Buffer;
  fileName: string;
  matterId: string;
  mimeType: string;
  userId: string;
}) {
  const [document] = await uploadMatterDocuments({
    config: {
      ...defaultFileSelectorConfig,
      acceptedMimeTypes: null,
    },
    files: [
      new File([new Uint8Array(input.bytes)], input.fileName, {
        type: input.mimeType,
      }),
    ],
    matterId: input.matterId,
    userId: input.userId,
  });

  if (!document) {
    throw new Error("Fixture upload did not create a matter document.");
  }

  return document;
}

function textPdfFixture() {
  return Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >> endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
6 0 obj << /Length 44 >> stream
BT /F1 24 Tf 100 700 Td (First page text) Tj ET
endstream endobj
7 0 obj << /Length 45 >> stream
BT /F1 24 Tf 100 700 Td (Second page text) Tj ET
endstream endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000121 00000 n 
0000000241 00000 n 
0000000361 00000 n 
0000000431 00000 n 
0000000525 00000 n 
trailer << /Root 1 0 R /Size 8 >>
startxref
620
%%EOF`);
}

function imageOnlyPdfFixture() {
  return Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >> endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer << /Root 1 0 R /Size 4 >>
startxref
207
%%EOF`);
}

async function saveSelection(input: {
  documentIds: string[];
  matterId: string;
  userId: string;
  workflowDefinitionId?: string;
  workflowRunId: string;
}) {
  return saveFileSelectorStepSelection({
    config: defaultFileSelectorConfig,
    matterId: input.matterId,
    selectedMatterDocumentIds: input.documentIds,
    stepId: "select-source-files",
    uploadedDuringStepMatterDocumentIds: [],
    userId: input.userId,
    workflowDefinitionId: input.workflowDefinitionId ?? "chronology",
    workflowRunId: input.workflowRunId,
  });
}

function promptField(prompt: string, fieldName: string) {
  const match = prompt.match(new RegExp(`^${fieldName}: (.+)$`, "m"));

  if (!match?.[1]) {
    throw new Error(`Prompt did not include ${fieldName}.`);
  }

  return match[1].trim();
}

function mockChronologyAI(options?: {
  delayMs?: number;
  failFirstCall?: boolean;
  invalidJson?: boolean;
  neverResolveFirstCall?: boolean;
  onCallFinished?: (callNumber: number) => void;
  onCallStarted?: (callNumber: number) => void;
}): MockAIService {
  let callCount = 0;

  return {
    get callCount() {
      return callCount;
    },
    generateText: async (
      request: MockGenerateTextRequest,
    ): Promise<MockGenerateTextResponse> => {
      callCount += 1;
      const callNumber = callCount;
      options?.onCallStarted?.(callNumber);

      try {
        if (options?.delayMs) {
          await new Promise((resolve) => {
            setTimeout(resolve, options.delayMs);
          });
        }

        if (options?.failFirstCall && callNumber === 1) {
          throw new Error("Mock AI window failure.");
        }

        if (options?.neverResolveFirstCall && callNumber === 1) {
          return new Promise<MockGenerateTextResponse>(() => {});
        }

        if (options?.invalidJson) {
          return {
            content: "not json",
            model: "mock-model",
            provider: "mock",
          };
        }

        const prompt = request.messages.at(-1)?.content ?? "";
        const sourceFileName = promptField(prompt, "sourceFileName");
        const hasPageTwo = prompt.includes('<!-- ml:page {"page":2} -->');

        return {
          content: JSON.stringify({
            facts: [
              {
                extractionConfidence: "high",
                factType: "DATED_EVENT",
                fields: {
                  date: "2024-01-12",
                  description: `Chronology fact from ${sourceFileName}.`,
                  organizations: null,
                  people: "Officer Smith, Defendant",
                },
                pageEnd: hasPageTwo ? 2 : null,
                pageStart: 1,
                sourceExcerpt: hasPageTwo ? "First page text Second page text" : "Chronology text notes.",
              },
            ],
          }),
          model: "mock-model",
          provider: "mock",
        };
      } finally {
        options?.onCallFinished?.(callNumber);
      }
    },
  };
}

function mockEminentDomainAI(): MockAIService {
  let callCount = 0;

  return {
    get callCount() {
      return callCount;
    },
    generateText: async (): Promise<MockGenerateTextResponse> => {
      callCount += 1;

      return {
        content: JSON.stringify({
          facts: [
            {
              extractionConfidence: "high",
              factType: "MATTER_ENTITY",
              fields: {
                entityType: "property-owner",
                name: "Jane Owner",
              },
              pageEnd: 1,
              pageStart: 1,
              sourceExcerpt: "Offer letter from City of Austin to Jane Owner.",
            },
            {
              extractionConfidence: "high",
              factType: "MATTER_ENTITY",
              fields: {
                department: null,
                entityType: "condemning-authority",
                name: "City of Austin",
              },
              pageEnd: 1,
              pageStart: 1,
              sourceExcerpt: "Offer letter from City of Austin to Jane Owner.",
            },
          ],
        }),
        model: "mock-model",
        provider: "mock",
      };
    },
  };
}

function mockEminentDomainOwnerResponseAI(input?: {
  onPrompt?: (prompt: string) => void;
}): MockAIService {
  let callCount = 0;

  return {
    get callCount() {
      return callCount;
    },
    generateText: async (request): Promise<MockGenerateTextResponse> => {
      callCount += 1;
      input?.onPrompt?.(request.messages.at(-1)?.content ?? "");

      return {
        content: JSON.stringify({
          facts: [
            {
              extractionConfidence: "high",
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
        }),
        model: "mock-model",
        provider: "mock",
      };
    },
  };
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 3000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error("Timed out waiting for condition.");
}

test("extraction step is registered", () => {
  expect(registeredExtractionStep).toMatchObject({
    displayName: "Extraction",
    type: "extraction",
  });
  expect(registeredExtractionStep.parameterSchema.required).toContain(
    "inputStepId",
  );
});

test.each([
  {
    content: "{\"facts\":[{\"extractionConfidence\":\"high\",\"factType\":\"DATED_EVENT\",\"fields\":{\"date\":\"2026-01-15\",\"description\":\"Initial offer letter was sent.\",\"people\":\"Jane Owner\",\"organizations\":null},\"sourceExcerpt\":\"Initial offer letter sent.\",\"pageStart\":1,\"pageEnd\":1}]}",
    model: "gpt-5-mini",
    provider: "openai",
  },
  {
    content: "```json\n{\"facts\":[{\"extractionConfidence\":\"medium\",\"factType\":\"DATED_EVENT\",\"fields\":{\"date\":\"2026-01-15\",\"description\":\"Initial offer letter was sent.\",\"people\":\"Jane Owner\",\"organizations\":null},\"sourceExcerpt\":\"Initial offer letter sent.\",\"pageStart\":1,\"pageEnd\":1}]}\n```",
    model: "gemma3:4b",
    provider: "ollama",
  },
  {
    content: "Here is the structured extraction.\n{\"facts\":[{\"extractionConfidence\":\"low\",\"factType\":\"DATED_EVENT\",\"fields\":{\"date\":\"2026-01-15\",\"description\":\"Initial offer letter was sent.\",\"people\":\"Jane Owner\",\"organizations\":null},\"sourceExcerpt\":\"Initial offer letter sent.\",\"pageStart\":1,\"pageEnd\":1}]}\nNo additional facts found.",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
  },
])(
  "extraction profile validates mocked $provider output with the shared schema",
  async ({ content, model, provider }) => {
    let requestedSchema: Record<string, unknown> | undefined;
    const result = await runExtractionProfile(chronologyRunnerProfile, {
      aiService: {
        generateText: async (request) => {
          requestedSchema = request.responseFormat?.schema;

          return {
            content,
            model,
            provider,
          };
        },
      },
      readyDocuments: [
        {
          fileName: "provider-notes.txt",
          id: "doc_provider",
          markdown: "Initial offer letter sent.",
        },
      ],
    });

    expect(requestedSchema).toBe(chronologyRunnerProfile.responseFormat?.schema);
    expect(result).toMatchObject({
      error: null,
      itemCount: 1,
      model,
      provider,
      status: "COMPLETED",
    });
  },
);

test("Eminent Domain extraction parses mocked GPT-5.4 nano structured facts", async () => {
  let requestedSchema: Record<string, unknown> | undefined;
  const result = await runExtractionProfile(eminentDomainFactsProfile, {
    aiService: {
      generateText: async (request) => {
        requestedSchema = request.responseFormat?.schema;

        return {
          content: JSON.stringify({
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
                sourceExcerpt: "Ramirez Family Holdings, LLC owns Parcel 14.",
              },
              {
                extractionConfidence: "high",
                factType: "EVENT",
                fields: {
                  description: "The City issued its final written offer.",
                  eventDate: "February 20, 2026",
                  eventType: "final-offer-issued",
                  parcelNumber: "Parcel 14",
                },
                pageEnd: 1,
                pageStart: 1,
                sourceExcerpt: "The City issued its final written offer on February 20, 2026.",
              },
            ],
          }),
          model: "gpt-5.4-nano",
          provider: "openai",
        };
      },
    },
    readyDocuments: [
      {
        fileName: "2026-02-20 Final Offer Letter - Parcel 14.pdf",
        id: "doc_gpt_54_nano",
        markdown: [
          "<!-- ml:page {\"page\":1} -->",
          "Ramirez Family Holdings, LLC owns Parcel 14.",
          "The City issued its final written offer on February 20, 2026.",
        ].join("\n"),
      },
    ],
  });

  expect(requestedSchema).toBe(eminentDomainFactsProfile.responseFormat?.schema);
  expect(result).toMatchObject({
    error: null,
    itemCount: 2,
    model: "gpt-5.4-nano",
    provider: "openai",
    status: "COMPLETED",
  });
  expect(result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        evidence: expect.objectContaining({
          documentId: "doc_gpt_54_nano",
          documentName: "2026-02-20 Final Offer Letter - Parcel 14.pdf",
          pageEnd: 1,
          pageStart: 1,
        }),
        factType: "EVENT",
      }),
    ]),
  );
});

test("generic extraction step runs eminent domain assessment with configured output key", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `eminent-domain-extraction-run-${Date.now()}`;
  const eminentDomainExtractionStep: WorkflowStepDefinition = {
    autorun: true,
    description:
      "Extract raw typed facts from the selected documents.",
    id: "analyze-case-documents",
    name: "Analyze Case Documents",
    parameters: {
      inputStepId: "select-source-files",
      outputKey: "eminentDomainCaseAssessment",
      profile: "eminent-domain-facts",
      representationType: "MARKDOWN",
      taskId: "eminent-domain-facts",
      ui: {
        profileLine: null,
        runButtonLabel: "Analyze case documents",
        runningDocumentLabel: "Analyzing",
      },
    },
    type: "extraction",
  };

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from("Offer letter from City of Austin to Jane Owner."),
      fileName: "offer-letter.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowDefinitionId: "eminent-domain-case-assessment",
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockEminentDomainAI(),
      matterId: matter.id,
      step: eminentDomainExtractionStep,
      workflowDefinitionId: "eminent-domain-case-assessment",
      workflowRunId,
    });

    expect(output).toMatchObject({
      artifactReferences: {},
      outputKey: "eminentDomainCaseAssessment",
      profile: "eminent-domain-facts",
      readyRepresentationCount: 1,
      status: "completed",
    });
    expect(output.eminentDomainCaseAssessment).toMatchObject({
      facts: [
        expect.objectContaining({
          evidence: expect.objectContaining({
            documentId: textDocument.id,
            documentName: "offer-letter.txt",
          }),
          factType: "MATTER_ENTITY",
          fields: {
            entityType: "property-owner",
            name: "Jane Owner",
          },
        }),
        expect.objectContaining({
          factType: "MATTER_ENTITY",
          fields: {
            entityType: "condemning-authority",
            name: "City of Austin",
          },
        }),
      ],
      profileId: "eminent-domain-facts",
    });
    expect(output.factsByType).toEqual({
      MATTER_ENTITY: 2,
    });
    expect(output.rawFacts).toHaveLength(2);
    expect(output.collapsedFacts).toHaveLength(2);
    expect(output.collapseSummary).toMatchObject({
      collapsedFactCount: 2,
      rawFactCount: 2,
      countsByFactType: {
        MATTER_ENTITY: {
          collapsed: 2,
          raw: 2,
        },
      },
    });

    const extractionRun = await prisma.workflowExtractionRun.findUniqueOrThrow({
      where: {
        id: output.extractionRunId,
      },
    });

    expect(extractionRun).toMatchObject({
      matterId: matter.id,
      profile: "eminent-domain-facts",
      representationType: "MARKDOWN",
      status: WorkflowExtractionRunStatus.COMPLETED,
      stepId: eminentDomainExtractionStep.id,
      workflowRunId,
    });
    expect(extractionRun.metadataJson).toMatchObject({
      collapseSummary: {
        collapsedFactCount: 2,
        rawFactCount: 2,
      },
      itemCountsByType: {
        MATTER_ENTITY: 2,
      },
      selectedDocumentCount: 1,
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("eminent domain extraction persists document-metadata-derived dates", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `eminent-domain-metadata-run-${Date.now()}`;
  const eminentDomainExtractionStep: WorkflowStepDefinition = {
    autorun: true,
    description:
      "Extract raw typed facts from the selected documents.",
    id: "analyze-case-documents",
    name: "Analyze Case Documents",
    parameters: {
      inputStepId: "select-source-files",
      outputKey: "eminentDomainCaseAssessment",
      profile: "eminent-domain-facts",
      representationType: "MARKDOWN",
      taskId: "eminent-domain-facts",
    },
    type: "extraction",
  };
  let capturedPrompt = "";

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from(
        "Owner called to report continued concerns about construction access near the west driveway.",
      ),
      fileName: "2026-04-15 Owner Notes Access Concerns.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowDefinitionId: "eminent-domain-case-assessment",
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockEminentDomainOwnerResponseAI({
        onPrompt: (prompt) => {
          capturedPrompt = prompt;
        },
      }),
      matterId: matter.id,
      step: eminentDomainExtractionStep,
      workflowDefinitionId: "eminent-domain-case-assessment",
      workflowRunId,
    });

    expect(capturedPrompt).toContain("Document metadata:");
    expect(capturedPrompt).toContain("- Document date: 2026-04-15");
    expect(capturedPrompt).toContain("- Document date source: filename");
    expect(output).toMatchObject({
      collapsedFacts: [
        expect.objectContaining({
          factType: "EVENT",
          fields: expect.objectContaining({
            eventDate: "2026-04-15",
          }),
        }),
      ],
      collapseSummary: expect.objectContaining({
        collapsedFactCount: 1,
        rawFactCount: 1,
      }),
      extractedFactCount: 1,
      factsByType: {
        EVENT: 1,
      },
      status: "completed",
    });
    expect(output.rawFacts).toHaveLength(1);

    const [fact] = output.facts as Array<{
      evidence: Record<string, unknown>;
      fields: Record<string, unknown>;
      factType: string;
    }>;

    expect(fact).toMatchObject({
      evidence: {
        documentDate: "2026-04-15",
        documentDateSource: "filename",
        documentId: textDocument.id,
        documentName: "2026-04-15 Owner Notes Access Concerns.txt",
      },
      factType: "EVENT",
      fields: {
        eventDate: "2026-04-15",
        eventType: "owner-response",
      },
    });
    expect(fact?.evidence.pageStart).toBeUndefined();
    expect(fact?.evidence.pageEnd).toBeUndefined();

    const stepOutput = await prisma.workflowRunStepOutput.findUniqueOrThrow({
      where: {
        workflowRunId_stepId: {
          stepId: eminentDomainExtractionStep.id,
          workflowRunId,
        },
      },
    });

    expect(stepOutput.outputJson).toMatchObject({
      collapsedFacts: [
        expect.objectContaining({
          factType: "EVENT",
        }),
      ],
      collapseSummary: expect.objectContaining({
        collapsedFactCount: 1,
        rawFactCount: 1,
      }),
      facts: [
        expect.objectContaining({
          evidence: expect.objectContaining({
            documentDate: "2026-04-15",
            documentDateSource: "filename",
          }),
          fields: expect.objectContaining({
            eventDate: "2026-04-15",
          }),
        }),
      ],
      rawFacts: [
        expect.objectContaining({
          fields: expect.objectContaining({
            eventDate: "2026-04-15",
          }),
        }),
      ],
      status: "completed",
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("autorun starts extraction in the background and exposes activity for the active step", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `autorun-observability-${Date.now()}`;
  const autorunExtractionStep: WorkflowStepDefinition = {
    ...extractionStep,
    autorun: true,
  };

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from("Chronology text notes."),
      fileName: "notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockChronologyAI(),
      executionMode: "autorun",
      matterId: matter.id,
      step: autorunExtractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output.status).toBe("running");

    await waitForCondition(async () => {
      const startedEvent = await prisma.workflowRunStepActivity.findFirst({
        where: {
          code: "extraction.prepare.started",
          stepId: autorunExtractionStep.id,
          workflowRunId,
        },
      });

      return Boolean(startedEvent);
    });

    const activityEvents = await prisma.workflowRunStepActivity.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        stepId: autorunExtractionStep.id,
        workflowRunId,
      },
    });

    expect(activityEvents[0]).toMatchObject({
      code: "extraction.prepare.started",
      stepId: autorunExtractionStep.id,
      workflowRunId,
    });

    const state = await loadExtractionStepState({
      matterId: matter.id,
      step: autorunExtractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(state.activityEvents.map((event) => event.code)).toContain(
      "extraction.prepare.started",
    );

    await waitForCondition(async () => {
      const latestOutput = await prisma.workflowRunStepOutput.findUnique({
        select: {
          outputJson: true,
        },
        where: {
          workflowRunId_stepId: {
            stepId: autorunExtractionStep.id,
            workflowRunId,
          },
        },
      });

      return (
        typeof latestOutput?.outputJson === "object" &&
        latestOutput.outputJson !== null &&
        !Array.isArray(latestOutput.outputJson) &&
        latestOutput.outputJson.status === "completed"
      );
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("extraction state does not surface stale pdfjs worker failures", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `stale-worker-error-run-${Date.now()}`;

  try {
    const pdfDocument = await uploadFixture({
      bytes: textPdfFixture(),
      fileName: "stale-worker-error.pdf",
      matterId: matter.id,
      mimeType: "application/pdf",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [pdfDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });
    await prisma.matterDocumentRepresentation.create({
      data: {
        error:
          'Setting up fake worker failed: "Cannot find module \'/Users/stephenwalther/GitRepos/matter-layer-ai/matter-layer-ai/.next/dev/server/chunks/ssr/pdf.worker.mjs\' imported from /Users/stephenwalther/GitRepos/matter-layer-ai/matter-layer-ai/.next/dev/server/chunks/ssr/node_modules_pdfjs-dist_legacy_build_pdf_mjs_1p6i-7y._.js".',
        matterDocumentId: pdfDocument.id,
        status: MatterDocumentRepresentationStatus.FAILED,
        type: MatterDocumentRepresentationType.MARKDOWN,
      },
    });

    const state = await loadExtractionStepState({
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(state.documents).toEqual([
      expect.objectContaining({
        error: null,
        id: pdfDocument.id,
        representationStatus: "Not started",
      }),
    ]);
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("extraction step prepares TXT and PDF representations and persists output", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `extraction-run-${Date.now()}`;

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from("Chronology text notes."),
      fileName: "notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });
    const pdfDocument = await uploadFixture({
      bytes: textPdfFixture(),
      fileName: "report.pdf",
      matterId: matter.id,
      mimeType: "application/pdf",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id, pdfDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockChronologyAI(),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output).toMatchObject({
      collapsedEventCount: 2,
      failedRepresentationCount: 0,
      extractedFactCount: 2,
      factsByType: {
        DATED_EVENT: 2,
      },
      profile: "chronology",
      readyRepresentationCount: 2,
      selectedMatterDocumentIds: [textDocument.id, pdfDocument.id],
      status: "completed",
    });
    const chronologyArtifactId = output.artifactReferences.chronologyArtifactId;

    expect(chronologyArtifactId).toEqual(expect.any(String));
    expect(output.chronologyArtifactId).toBe(chronologyArtifactId);

    const extractionRun = await prisma.workflowExtractionRun.findUniqueOrThrow({
      where: {
        id: output.extractionRunId,
      },
    });

    expect(extractionRun).toMatchObject({
      matterId: matter.id,
      profile: "chronology",
      representationType: "MARKDOWN",
      status: WorkflowExtractionRunStatus.COMPLETED,
      stepId: extractionStep.id,
      workflowRunId,
    });
    expect(extractionRun.metadataJson).toMatchObject({
      aiModel: "mock-model",
      aiProvider: "mock",
      collapsedEventCount: 2,
      artifactReferences: {
        chronologyArtifactId,
      },
      itemCount: 2,
      itemCountsByType: {
        DATED_EVENT: 2,
      },
      selectedDocumentCount: 2,
    });

    expect(output.collapsedEvents).toHaveLength(2);
    expect(output.collapsedEvents[0]).toMatchObject({
      date: "2024-01-12",
    });
    expect(output.collapsedEvents[0]).toMatchObject({
      sources: [
        expect.objectContaining({
          sourceFileName: "notes.txt",
        }),
      ],
    });
    expect(output.collapsedEvents[0].sources).toEqual([
      expect.objectContaining({
        sourceFileName: "notes.txt",
      }),
    ]);

    const artifact = await prisma.workflowArtifact.findUniqueOrThrow({
      where: {
        id: chronologyArtifactId ?? "",
      },
    });

    expect(artifact).toMatchObject({
      matterId: matter.id,
      stepId: extractionStep.id,
      title: "Chronology",
      workflowRunId,
    });
    expect(artifact.content).not.toContain("Chronology of Events");
    expect(artifact.content).toContain("Notes p. 1");
    expect(artifact.content).toContain("Report pp. 1-2");
    expect(artifact.content).not.toContain("Generated from selected matter documents.");
    expect(artifact.metadataJson).toMatchObject({
      collapsedEventCount: 2,
      generatedFromFactCount: 2,
      profile: "chronology",
      sourceDocumentCount: 2,
    });

    const activityEvents = await prisma.workflowRunStepActivity.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        stepId: extractionStep.id,
        workflowRunId,
      },
    });
    const activityCodes = activityEvents.map((event) => event.code);

    expect(activityCodes).toContain("extraction.prepare.started");
    expect(activityCodes).toContain("extraction.prepare.selected_documents_loaded");
    expect(activityCodes.filter((code) => code === "extraction.prepare.document_started")).toHaveLength(2);
    expect(activityCodes).toContain("extraction.prepare.representation_lookup_started");
    expect(activityCodes).toContain("extraction.prepare.extraction_started");
    expect(activityCodes).toContain("extraction.prepare.extraction_window_started");
    expect(activityCodes).toContain("extraction.prepare.extraction_window_completed");
    expect(activityCodes).toContain("extraction.prepare.extraction_completed");
    expect(activityCodes).toContain("extraction.prepare.document_completed");
    expect(activityCodes).toContain("extraction.prepare.completed");
    expect(activityCodes).toContain("extraction.prepare.artifacts_created");
    expect(
      activityEvents.some((event) =>
        event.message.includes("Extracted") &&
        event.message.includes("candidate chronology fact"),
      ),
    ).toBe(true);
    expect(
      activityEvents.some((event) => event.documentName === "report.pdf"),
    ).toBe(true);

    const rawFacts = output.facts as Array<{
      evidence: { documentId: string; pageEnd?: number; pageStart?: number };
    }>;

    expect(rawFacts).toHaveLength(2);
    expect(rawFacts.map((fact) => fact.evidence.documentId).sort()).toEqual(
      [pdfDocument.id, textDocument.id].sort(),
    );
    expect(
      rawFacts.find((fact) => fact.evidence.documentId === pdfDocument.id)
        ?.evidence,
    ).toMatchObject({
      pageEnd: 2,
      pageStart: 1,
    });

    const representations = await prisma.matterDocumentRepresentation.findMany({
      orderBy: {
        matterDocumentId: "asc",
      },
      where: {
        matterDocumentId: {
          in: [textDocument.id, pdfDocument.id],
        },
      },
    });

    expect(representations).toHaveLength(2);
    expect(representations.every(
      (representation) =>
        representation.status === MatterDocumentRepresentationStatus.READY,
    )).toBe(true);
    expect(
      representations.find(
        (representation) => representation.matterDocumentId === pdfDocument.id,
      )?.content,
    ).toContain('<!-- ml:page {"page":1} -->');

    const stepOutput = await prisma.workflowRunStepOutput.findUniqueOrThrow({
      where: {
        workflowRunId_stepId: {
          stepId: extractionStep.id,
          workflowRunId,
        },
      },
    });

    expect(stepOutput.outputJson).toMatchObject({
      chronologyArtifactId,
      collapsedEventCount: 2,
      extractedFactCount: 2,
      extractionRunId: output.extractionRunId,
      factsByType: {
        DATED_EVENT: 2,
      },
      readyRepresentationCount: 2,
      status: "completed",
    });

    const representationUpdatedAt = representations.map((representation) =>
      representation.updatedAt.getTime(),
    );
    const rerunOutput = await runExtractionStep({
      aiService: mockChronologyAI(),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });
    const rerunRepresentations = await prisma.matterDocumentRepresentation.findMany({
      orderBy: {
        matterDocumentId: "asc",
      },
      where: {
        matterDocumentId: {
          in: [textDocument.id, pdfDocument.id],
        },
      },
    });

    expect(rerunOutput.extractionRunId).not.toBe(output.extractionRunId);
    expect(rerunOutput.artifactReferences.chronologyArtifactId).not.toBe(
      chronologyArtifactId,
    );
    expect(rerunRepresentations.map((representation) =>
      representation.updatedAt.getTime(),
    )).toEqual(representationUpdatedAt);
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("chronology extraction runs documents with bounded parallelism and preserves selected order", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `parallel-extraction-run-${Date.now()}`;
  const previousConcurrency =
    process.env.MATTER_LAYER_EXTRACTION_DOCUMENT_CONCURRENCY;
  let activeCallCount = 0;
  let maxActiveCallCount = 0;

  process.env.MATTER_LAYER_EXTRACTION_DOCUMENT_CONCURRENCY = "2";

  try {
    const firstDocument = await uploadFixture({
      bytes: Buffer.from("Chronology text notes."),
      fileName: "first-notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });
    const secondDocument = await uploadFixture({
      bytes: Buffer.from("Chronology text notes."),
      fileName: "second-notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [firstDocument.id, secondDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockChronologyAI({
        delayMs: 75,
        onCallFinished: () => {
          activeCallCount -= 1;
        },
        onCallStarted: () => {
          activeCallCount += 1;
          maxActiveCallCount = Math.max(maxActiveCallCount, activeCallCount);
        },
      }),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(maxActiveCallCount).toBe(2);
    expect(output.status).toBe("completed");
    expect((output.facts as Array<{ evidence: { documentId: string } }>).map((fact) => fact.evidence.documentId)).toEqual([
      firstDocument.id,
      secondDocument.id,
    ]);
  } finally {
    if (previousConcurrency) {
      process.env.MATTER_LAYER_EXTRACTION_DOCUMENT_CONCURRENCY =
        previousConcurrency;
    } else {
      delete process.env.MATTER_LAYER_EXTRACTION_DOCUMENT_CONCURRENCY;
    }

    await cleanupMatter(matter.id);
  }
});

test("image-only PDFs produce a failed extraction run with OCR error", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `failed-extraction-run-${Date.now()}`;

  try {
    const pdfDocument = await uploadFixture({
      bytes: imageOnlyPdfFixture(),
      fileName: "scan.pdf",
      matterId: matter.id,
      mimeType: "application/pdf",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [pdfDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockChronologyAI(),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output).toMatchObject({
      failedRepresentationCount: 1,
      readyRepresentationCount: 0,
      status: "failed",
    });

    const extractionRun = await prisma.workflowExtractionRun.findUniqueOrThrow({
      where: {
        id: output.extractionRunId,
      },
    });

    expect(extractionRun.status).toBe(WorkflowExtractionRunStatus.FAILED);
    expect(extractionRun.error).toContain("OCR is not implemented yet");
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("failed AI windows produce partial and failed extraction runs", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `partial-extraction-run-${Date.now()}`;

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from("Chronology text notes."),
      fileName: "notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });
    const pdfDocument = await uploadFixture({
      bytes: textPdfFixture(),
      fileName: "report.pdf",
      matterId: matter.id,
      mimeType: "application/pdf",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id, pdfDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const partialOutput = await runExtractionStep({
      aiService: mockChronologyAI({
        failFirstCall: true,
      }),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(partialOutput.status).toBe("partial_failed");
    expect(partialOutput.extractedFactCount).toBeGreaterThan(0);

    const failedOutput = await runExtractionStep({
      aiService: mockChronologyAI({
        invalidJson: true,
      }),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(failedOutput).toMatchObject({
      extractedFactCount: 0,
      status: "failed",
    });
    expect(failedOutput.facts).toHaveLength(0);
    expect(failedOutput.collapsedEvents).toHaveLength(0);
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("window extraction activity exposes per-window progress and failures", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `window-activity-extraction-run-${Date.now()}`;

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from([
        '<!-- ml:page {"page":1} -->',
        "Chronology text notes page one.\n".repeat(900),
        '<!-- ml:page {"page":2} -->',
        "Chronology text notes page two.\n".repeat(900),
        '<!-- ml:page {"page":3} -->',
        "Chronology text notes page three.\n".repeat(900),
      ].join("\n")),
      fileName: "long-notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockChronologyAI({
        failFirstCall: true,
      }),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output.status).toBe("partial_failed");
    expect(output.extractionWindowCount).toBeGreaterThan(1);

    const activityEvents = await prisma.workflowRunStepActivity.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        stepId: extractionStep.id,
        workflowRunId,
      },
    });
    const activityCodes = activityEvents.map((event) => event.code);
    const startedWindow = activityEvents.find(
      (event) => event.code === "extraction.prepare.extraction_window_started",
    );
    const failedWindow = activityEvents.find(
      (event) => event.code === "extraction.prepare.extraction_window_failed",
    );

    expect(activityCodes).toContain("extraction.prepare.extraction_window_started");
    expect(activityCodes).toContain("extraction.prepare.extraction_window_failed");
    expect(activityCodes).toContain("extraction.prepare.extraction_window_completed");
    expect(startedWindow?.message).toContain("Window 1 of");
    expect(startedWindow?.metadataJson).toMatchObject({
      windowIndex: 1,
    });
    expect(failedWindow?.metadataJson).toMatchObject({
      error: "Mock AI window failure.",
      errorCode: "AI_PROVIDER_REQUEST_FAILED",
      failedWindowCount: 1,
      windowIndex: 1,
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("hung AI window calls time out and persist failed output", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `window-timeout-extraction-run-${Date.now()}`;
  const previousTimeout = process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_TIMEOUT_MS;
  const previousHeartbeat = process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_HEARTBEAT_MS;

  process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_TIMEOUT_MS = "75";
  process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_HEARTBEAT_MS = "25";

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from("Chronology text notes."),
      fileName: "notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockChronologyAI({
        neverResolveFirstCall: true,
      }),
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output).toMatchObject({
      extractedFactCount: 0,
      status: "failed",
    });
    expect(output.error).toMatchObject({
      code: "AI_PROVIDER_TIMEOUT",
    });
    expect(output.error?.userMessage).toContain("did not return a response in time");
    expect(output.error?.documentErrors?.[0]?.message).toContain(
      "AI provider did not return chronology extraction",
    );

    const activityEvents = await prisma.workflowRunStepActivity.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        stepId: extractionStep.id,
        workflowRunId,
      },
    });
    const activityCodes = activityEvents.map((event) => event.code);
    const waitingWindow = activityEvents.find(
      (event) => event.code === "extraction.prepare.extraction_window_waiting",
    );
    const failedWindow = activityEvents.find(
      (event) => event.code === "extraction.prepare.extraction_window_failed",
    );

    expect(activityCodes).toContain("extraction.prepare.extraction_window_started");
    expect(activityCodes).toContain("extraction.prepare.extraction_window_waiting");
    expect(activityCodes).toContain("extraction.prepare.extraction_window_failed");
    expect(waitingWindow?.message).toContain("Still waiting for the AI provider");
    expect(waitingWindow?.metadataJson).toMatchObject({
      timeoutMs: 75,
      windowIndex: 1,
    });
    expect(failedWindow?.metadataJson).toMatchObject({
      errorCode: "AI_PROVIDER_TIMEOUT",
      windowIndex: 1,
    });
    expect(JSON.stringify(failedWindow?.metadataJson)).toContain(
      "AI provider did not return chronology extraction",
    );
  } finally {
    if (previousTimeout) {
      process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_TIMEOUT_MS = previousTimeout;
    } else {
      delete process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_TIMEOUT_MS;
    }

    if (previousHeartbeat) {
      process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_HEARTBEAT_MS = previousHeartbeat;
    } else {
      delete process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_HEARTBEAT_MS;
    }

    await cleanupMatter(matter.id);
  }
});

test("unexpected autorun extraction errors persist a failed output instead of stale running state", async () => {
  const { matter, user } = await createUserAndMatter();
  const workflowRunId = `autorun-recovery-extraction-run-${Date.now()}`;
  const autorunExtractionStep: WorkflowStepDefinition = {
    ...extractionStep,
    autorun: true,
  };

  try {
    const textDocument = await uploadFixture({
      bytes: Buffer.from("Chronology text notes."),
      fileName: "notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await saveSelection({
      documentIds: [textDocument.id],
      matterId: matter.id,
      userId: user.id,
      workflowRunId,
    });

    const output = await runExtractionStep({
      aiService: mockChronologyAI(),
      executionMode: "autorun",
      matterId: matter.id,
      onProgress: () => {
        throw new Error("Injected progress persistence failure.");
      },
      step: autorunExtractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output.status).toBe("running");

    await waitForCondition(async () => {
      const latestOutput = await prisma.workflowRunStepOutput.findUnique({
        select: {
          outputJson: true,
        },
        where: {
          workflowRunId_stepId: {
            stepId: autorunExtractionStep.id,
            workflowRunId,
          },
        },
      });

      return (
        typeof latestOutput?.outputJson === "object" &&
        latestOutput.outputJson !== null &&
        !Array.isArray(latestOutput.outputJson) &&
        latestOutput.outputJson.status === "failed"
      );
    });

    const state = await loadExtractionStepState({
      matterId: matter.id,
      step: autorunExtractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(state.latestOutput).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
      },
      status: "failed",
    });
    expect(state.latestOutput?.progress?.status).toBe("failed");
    expect(state.activityEvents.at(-1)).toMatchObject({
      code: "extraction.prepare.failed",
      level: "error",
    });

    const extractionRun = await prisma.workflowExtractionRun.findUniqueOrThrow({
      where: {
        id: state.latestOutput?.extractionRunId ?? "",
      },
    });

    expect(extractionRun.status).toBe(WorkflowExtractionRunStatus.FAILED);
    expect(extractionRun.error).toContain("Injected progress persistence failure.");
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("extraction step stores structured errors for cross-matter selected document IDs", async () => {
  const { matter, user } = await createUserAndMatter();
  const otherMatter = await prisma.matter.create({
    data: {
      name: `Other Extraction Matter ${Date.now()}`,
    },
  });
  const workflowRunId = `cross-matter-extraction-run-${Date.now()}`;

  try {
    const otherDocument = await uploadFixture({
      bytes: Buffer.from("Other matter notes."),
      fileName: "other.txt",
      matterId: otherMatter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await prisma.workflowRun.create({
      data: {
        id: workflowRunId,
        matterId: matter.id,
        workflowDefinitionId: "chronology",
      },
    });
    await prisma.workflowRunStepOutput.create({
      data: {
        outputJson: {
          selectedMatterDocumentIds: [otherDocument.id],
        },
        stepId: "select-source-files",
        workflowRunId,
      },
    });

    const output = await runExtractionStep({
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });
    const persistedOutput = await prisma.workflowRunStepOutput.findUnique({
      where: {
        workflowRunId_stepId: {
          stepId: extractionStep.id,
          workflowRunId,
        },
      },
    });

    expect(output).toMatchObject({
      error: {
        code: "DOCUMENT_ACCESS_DENIED",
        documentErrors: [
          {
            matterDocumentId: otherDocument.id,
            userMessage: "This document is not available in the current matter.",
          },
        ],
        userMessage:
          "Matter Layer could not prepare the selected documents because one or more files are not available in this matter.",
      },
      failedDocumentIds: [otherDocument.id],
      schemaVersion: 1,
      status: "failed",
    });
    expect(persistedOutput?.outputJson).toMatchObject({
      error: {
        code: "DOCUMENT_ACCESS_DENIED",
      },
      extractionRunId: output.extractionRunId,
      failedDocumentIds: [otherDocument.id],
      schemaVersion: 1,
      status: "failed",
    });
    await expect(
      prisma.workflowRunStepActivity.findMany({
        orderBy: {
          createdAt: "asc",
        },
        where: {
          stepId: extractionStep.id,
          workflowRunId,
        },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "extraction.prepare.started",
        }),
        expect.objectContaining({
          code: "extraction.prepare.failed",
          level: "error",
        }),
      ]),
    );
  } finally {
    await cleanupMatter(matter.id);
    await cleanupMatter(otherMatter.id);
  }
});
