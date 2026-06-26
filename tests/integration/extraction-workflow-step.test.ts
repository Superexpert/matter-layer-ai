import {
  MatterDocumentRepresentationStatus,
  PrismaClient,
  WorkflowExtractionRunStatus,
} from "@prisma/client";
import { afterAll, expect, test } from "vitest";

import { workflowStepRegistry } from "../../services/workflows/registry";
import type { WorkflowStepDefinition } from "../../services/workflows/types";
import { saveFileSelectorStepSelection } from "../../workflow-steps/file-selector/server";
import { defaultFileSelectorConfig } from "../../workflow-steps/file-selector/schema";
import { uploadMatterDocuments } from "../../workflow-steps/file-selector/server";
import { runExtractionStep } from "../../workflow-steps/extraction/server";

const prisma = new PrismaClient();

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
  workflowRunId: string;
}) {
  return saveFileSelectorStepSelection({
    config: defaultFileSelectorConfig,
    matterId: input.matterId,
    selectedMatterDocumentIds: input.documentIds,
    stepId: "select-source-files",
    uploadedDuringStepMatterDocumentIds: [],
    userId: input.userId,
    workflowDefinitionId: "chronology",
    workflowRunId: input.workflowRunId,
  });
}

test("extraction step is registered", () => {
  expect(workflowStepRegistry.extraction).toMatchObject({
    displayName: "Extraction",
    type: "extraction",
  });
  expect(workflowStepRegistry.extraction.parameterSchema.required).toContain(
    "inputStepId",
  );
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
      matterId: matter.id,
      step: extractionStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output).toMatchObject({
      failedRepresentationCount: 0,
      profile: "chronology",
      readyRepresentationCount: 2,
      selectedMatterDocumentIds: [textDocument.id, pdfDocument.id],
      status: "completed",
    });

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
      extractionRunId: output.extractionRunId,
      readyRepresentationCount: 2,
      status: "completed",
    });

    const representationUpdatedAt = representations.map((representation) =>
      representation.updatedAt.getTime(),
    );
    const rerunOutput = await runExtractionStep({
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
    expect(rerunRepresentations.map((representation) =>
      representation.updatedAt.getTime(),
    )).toEqual(representationUpdatedAt);
  } finally {
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

test("extraction step rejects cross-matter selected document IDs", async () => {
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

    await expect(
      runExtractionStep({
        matterId: matter.id,
        step: extractionStep,
        workflowDefinitionId: "chronology",
        workflowRunId,
      }),
    ).rejects.toThrow("Every selected document must belong to the workflow run matter.");
  } finally {
    await cleanupMatter(matter.id);
    await cleanupMatter(otherMatter.id);
  }
});
