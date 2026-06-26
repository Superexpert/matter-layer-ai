import { expect, test } from "@playwright/test";
import {
  MatterDocumentRepresentationStatus,
  MatterDocumentSourceType,
  PrismaClient,
  WorkflowExtractionRunStatus,
  WorkflowRunStepFileSelectionSource,
} from "@prisma/client";

import {
  addTestAuthSession,
  seedTestAISettings,
  startNextTestServer,
} from "./next-test-server";

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("File Selector renders, validates, uploads, auto-selects, and persists selections", async ({
  page,
}) => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const server = await startNextTestServer({ port: 3221 });
  const user = await prisma.user.upsert({
    create: {
      email: "lawyer@smithlaw.com",
      name: "Test Lawyer",
    },
    update: {},
    where: {
      email: "lawyer@smithlaw.com",
    },
  });
  const matter = await prisma.matter.create({
    data: {
      name: `File Selector Matter ${Date.now()}`,
    },
  });
  const existingDocument = await prisma.matterDocument.create({
    data: {
      content: {
        create: {
          bytes: Buffer.from("existing chronology source"),
        },
      },
      fileName: "existing-source.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      size: 26,
      sourceType: MatterDocumentSourceType.upload,
      storageProvider: "database",
      storageKey: null,
      uploadedByUserId: user.id,
    },
  });

  try {
    await seedTestAISettings();
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/matters/${matter.id}`);

    await expect(page.getByTestId("available-workflows-panel")).toContainText(
      "Chronology",
    );
    await page.getByTestId("workflow-chip-chronology").click();

    await expect(page.getByTestId("file-selector-step")).toBeVisible();
    await expect(page.getByTestId("file-selector-step")).toContainText(
      "Select source documents",
    );
    await expect(page.getByTestId("file-selector-document-list")).toContainText(
      "existing-source.txt",
    );
    await expect(page.getByTestId("file-selector-continue")).toBeDisabled();
    await expect(page.getByTestId("file-selector-validation")).toContainText(
      "Select at least 1 file.",
    );

    await page
      .getByTestId(`file-selector-checkbox-${existingDocument.id}`)
      .check();
    await expect(page.getByTestId("file-selector-summary")).toContainText(
      "1 document selected.",
    );

    await page
      .getByTestId("file-selector-upload-input")
      .setInputFiles({
        buffer: Buffer.from("uploaded chronology source"),
        mimeType: "text/plain",
        name: "uploaded-source.txt",
      });
    await expect(page.getByTestId("file-selector-document-list")).toContainText(
      "uploaded-source.txt",
    );
    await expect(page.getByTestId("file-selector-summary")).toContainText(
      "2 documents selected.",
    );

    await page
      .getByTestId("file-selector-upload-input")
      .setInputFiles({
        buffer: Buffer.from("<html></html>"),
        mimeType: "text/html",
        name: "unsupported.html",
      });
    await expect(page.getByTestId("file-selector-validation")).toContainText(
      "Unsupported file type: text/html.",
    );

    await page.getByTestId("file-selector-continue").click();
    await expect(page.getByTestId("extraction-step")).toContainText(
      "Prepare source documents",
    );
    await expect(page.getByTestId("extraction-document-list")).toContainText(
      "existing-source.txt",
    );
    await expect(page.getByTestId("extraction-document-list")).toContainText(
      "uploaded-source.txt",
    );
    await page.getByTestId("extraction-run-button").click();
    await expect(page.getByTestId("extraction-summary")).toContainText(
      "2 documents ready for extraction.",
    );
    await expect(page.getByTestId("extraction-continue")).toBeEnabled();

    const persistedSelections = await prisma.workflowRunStepFile.findMany({
      include: {
        matterDocument: true,
      },
      orderBy: {
        matterDocument: {
          fileName: "asc",
        },
      },
      where: {
        stepId: "select-source-files",
        workflowRun: {
          matterId: matter.id,
          workflowDefinitionId: "chronology",
        },
      },
    });

    expect(persistedSelections).toHaveLength(2);
    expect(persistedSelections.map((selection) => selection.matterDocument.fileName)).toEqual([
      "existing-source.txt",
      "uploaded-source.txt",
    ]);
    const uploadedDocument = persistedSelections.find(
      (selection) => selection.matterDocument.fileName === "uploaded-source.txt",
    )?.matterDocument;

    expect(uploadedDocument?.storageProvider).toBe("database");
    expect(uploadedDocument?.storageKey).toBeNull();
    await expect(
      prisma.matterDocumentContent.findUnique({
        where: {
          matterDocumentId: uploadedDocument!.id,
        },
      }),
    ).resolves.toMatchObject({
      bytes: Buffer.from("uploaded chronology source"),
    });
    expect(
      persistedSelections.find(
        (selection) => selection.matterDocument.fileName === "existing-source.txt",
      )?.selectionSource,
    ).toBe(WorkflowRunStepFileSelectionSource.manual);
    expect(
      persistedSelections.find(
        (selection) => selection.matterDocument.fileName === "uploaded-source.txt",
      )?.selectionSource,
    ).toBe(WorkflowRunStepFileSelectionSource.uploaded_during_step);

    const representations = await prisma.matterDocumentRepresentation.findMany({
      where: {
        document: {
          matterId: matter.id,
        },
      },
    });

    expect(representations).toHaveLength(2);
    expect(
      representations.every(
        (representation) =>
          representation.status === MatterDocumentRepresentationStatus.READY,
      ),
    ).toBe(true);

    const extractionRun = await prisma.workflowExtractionRun.findFirstOrThrow({
      where: {
        matterId: matter.id,
        status: WorkflowExtractionRunStatus.COMPLETED,
      },
    });
    const extractionOutput = await prisma.workflowRunStepOutput.findFirstOrThrow({
      where: {
        stepId: "extract-chronology",
        workflowRunId: extractionRun.workflowRunId,
      },
    });
    expect(extractionOutput.outputJson).toMatchObject({
      extractionRunId: extractionRun.id,
      readyRepresentationCount: 2,
      status: "completed",
    });
  } finally {
    await prisma.workflowRunStepFile.deleteMany({
      where: {
        workflowRun: {
          matterId: matter.id,
        },
      },
    });
    await prisma.workflowRunStepOutput.deleteMany({
      where: {
        workflowRun: {
          matterId: matter.id,
        },
      },
    });
    await prisma.workflowExtractionRun.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.workflowRun.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matterDocument.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matter.delete({
      where: {
        id: matter.id,
      },
    });
    await server.stop();
  }
});
