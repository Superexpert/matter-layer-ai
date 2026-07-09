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

test("File Selector can select and clear all selectable documents", async ({ page }) => {
  test.setTimeout(45_000);
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const server = await startNextTestServer({ port: 3220 });
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
      name: `File Selector Bulk Matter ${Date.now()}`,
    },
  });
  const firstDocument = await prisma.matterDocument.create({
    data: {
      content: {
        create: {
          bytes: Buffer.from("first chronology source"),
        },
      },
      fileName: "first-source.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      size: 23,
      sourceType: MatterDocumentSourceType.upload,
      storageProvider: "database",
      storageKey: null,
      uploadedByUserId: user.id,
    },
  });
  const secondDocument = await prisma.matterDocument.create({
    data: {
      content: {
        create: {
          bytes: Buffer.from("second chronology source"),
        },
      },
      fileName: "second-source.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      size: 24,
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

    await page.getByTestId("workflow-chip-chronology").click();
    await expect(page.getByTestId("file-selector-step")).toBeVisible();
    await expect(page.getByTestId("file-selector-continue")).toBeDisabled();
    await expect(page.getByTestId("file-selector-select-all")).toContainText(
      "Select all",
    );

    await page.getByTestId("file-selector-select-all").click();
    await expect(
      page.getByTestId(`file-selector-checkbox-${firstDocument.id}`),
    ).toBeChecked();
    await expect(
      page.getByTestId(`file-selector-checkbox-${secondDocument.id}`),
    ).toBeChecked();
    await expect(page.getByTestId("file-selector-continue")).toBeEnabled();
    await expect(page.getByTestId("file-selector-select-all")).toContainText(
      "Clear selection",
    );

    await page.getByTestId("file-selector-select-all").click();
    await expect(
      page.getByTestId(`file-selector-checkbox-${firstDocument.id}`),
    ).not.toBeChecked();
    await expect(
      page.getByTestId(`file-selector-checkbox-${secondDocument.id}`),
    ).not.toBeChecked();
    await expect(page.getByTestId("file-selector-continue")).toBeDisabled();
    await expect(page.getByTestId("file-selector-select-all")).toContainText(
      "Select all",
    );

    await page
      .getByTestId(`file-selector-checkbox-${firstDocument.id}`)
      .check();
    await expect(
      page.getByTestId(`file-selector-checkbox-${firstDocument.id}`),
    ).toBeChecked();
    await expect(
      page.getByTestId(`file-selector-checkbox-${secondDocument.id}`),
    ).not.toBeChecked();
    await expect(page.getByTestId("file-selector-continue")).toBeEnabled();
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

test("File Selector renders, validates, uploads, auto-selects, and persists selections", async ({
  page,
}) => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );
  test.skip(
    true,
    "Legacy workflow journey still expects Chronology to end in a review editor step.",
  );

  const previousTestAIResponse = process.env.MATTER_LAYER_TEST_EXTRACTION_AI_RESPONSE;
  process.env.MATTER_LAYER_TEST_EXTRACTION_AI_RESPONSE = JSON.stringify({
    facts: [
      {
        actors: ["Test Lawyer"],
        confidence: "high",
        date: "2024-01-12",
        dateText: "January 12, 2024",
        eventSummary: "Uploaded chronology source was reviewed.",
        factType: "dated_event",
        isApproximateDate: false,
        sourceDocumentId: "placeholder",
        sourceFileName: "placeholder",
        sourcePages: [],
        sourceQuote: "uploaded chronology source",
      },
    ],
  });
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
      "Select Case Files",
    );
    await expect(page.getByTestId("file-selector-document-list")).toContainText(
      "existing-source.txt",
    );
    await expect(page.getByTestId("file-selector-continue")).toBeDisabled();
    await expect(page.getByTestId("file-selector-validation")).toHaveCount(0);
    await expect(page.getByTestId("file-selector-step")).not.toContainText(
      "Select at least 1 file.",
    );

    await page
      .getByTestId(`file-selector-checkbox-${existingDocument.id}`)
      .check();
    await expect(
      page.getByTestId(`file-selector-checkbox-${existingDocument.id}`),
    ).toBeChecked();
    await expect(page.getByTestId("file-selector-continue")).toBeEnabled();
    await expect(page.getByTestId("file-selector-step")).not.toContainText(
      "Selected documents",
    );
    await expect(page.getByTestId("file-selector-step")).not.toContainText(
      "Active Workflow",
    );
    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Active Workflow",
    );
    await expect(page.getByTestId("active-workflow-canvas")).toContainText(
      "Chronology",
    );
    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Current step:",
    );
    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Work Product Canvas",
    );
    await expect(page.getByTestId("workflow-run-canvas")).toContainText(
      "Select Case Files",
    );
    await expect(page.getByTestId("workflow-run-canvas")).toContainText(
      "Extract Facts",
    );
    await expect(page.getByTestId("workflow-run-canvas")).toContainText(
      "Review chronology",
    );
    await expect(
      page
        .getByTestId("workflow-run-canvas")
        .locator('li[aria-current="step"]'),
    ).toContainText("Select Case Files");

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
    const uploadedDocumentRow = page
      .getByTestId("file-selector-document-list")
      .locator("label")
      .filter({
        hasText: "uploaded-source.txt",
      });
    await expect(
      uploadedDocumentRow.getByRole("checkbox"),
    ).toBeChecked();
    await expect(
      page.getByTestId(`file-selector-checkbox-${existingDocument.id}`),
    ).toBeChecked();

    await page
      .getByTestId(`file-selector-checkbox-${existingDocument.id}`)
      .uncheck();
    await expect(
      page.getByTestId(`file-selector-checkbox-${existingDocument.id}`),
    ).not.toBeChecked();
    await page
      .getByTestId(`file-selector-checkbox-${existingDocument.id}`)
      .check();
    await expect(
      page.getByTestId(`file-selector-checkbox-${existingDocument.id}`),
    ).toBeChecked();
    await expect(
      uploadedDocumentRow.getByRole("checkbox"),
    ).toBeChecked();
    await expect(page.getByTestId("file-selector-continue")).toBeEnabled();
    await expect(page.getByTestId("file-selector-step")).not.toContainText(
      "Selected documents",
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
      "Extract Facts",
    );
    await expect(page.getByTestId("extraction-document-list")).toContainText(
      "existing-source.txt",
    );
    await expect(page.getByTestId("extraction-document-list")).toContainText(
      "uploaded-source.txt",
    );
    await expect(page.getByTestId("extraction-document-list")).not.toContainText(
      "text/plain",
    );
    await expect(page.getByTestId("extraction-step")).not.toContainText(
      "Active Workflow",
    );
    await expect(page.getByTestId("extraction-summary")).toHaveCount(0);
    await expect(page.getByTestId("extraction-step")).not.toContainText(
      "Preparation status",
    );
    await page.getByTestId("extraction-run-button").click();
    await expect(
      page.getByTestId(`extraction-document-status-${existingDocument.id}`),
    ).toContainText(
      "Prepared",
    );
    await expect(page.getByTestId("extraction-document-list")).not.toContainText(
      "Window 1 of 1",
    );
    await expect(
      page.getByTestId(`extraction-document-message-${existingDocument.id}`),
    ).toHaveCount(0);
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

    await page.getByTestId("extraction-continue").click();
    await expect(page.getByTestId("document-editor-step")).toContainText(
      "Review chronology",
    );
    await expect(page.getByTestId("document-editor-continue")).toBeEnabled();

    await page.getByTestId("document-editor-continue").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toContainText(
      "Unsaved document changes",
    );
    await page.getByTestId("cancel-unsaved-document").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toHaveCount(0);
    await expect(page.getByTestId("document-editor-step")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("document-editor-export-docx").click();
    await downloadPromise;
    await page.getByTestId("document-editor-continue").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toBeVisible();
    await page.getByTestId("leave-unsaved-document").click();
    await expect(page.getByTestId("available-workflows-panel")).toBeVisible();

    await page.getByTestId("workflow-chip-chronology").click();
    await page
      .getByTestId(`file-selector-checkbox-${existingDocument.id}`)
      .check();
    await page.getByTestId("file-selector-continue").click();
    await page.getByTestId("extraction-run-button").click();
    await expect(page.getByTestId("extraction-continue")).toBeEnabled();
    await page.getByTestId("extraction-continue").click();
    await expect(page.getByTestId("document-editor-step")).toBeVisible();

    await page.getByTestId("document-editor-save").click();
    await expect(page.getByText("Saved to Documents")).toBeVisible();
    await page
      .getByTestId("document-editor-content")
      .locator('[contenteditable="true"]')
      .click();
    await page.keyboard.type(" Added after save.");
    await page.getByTestId("document-editor-continue").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toBeVisible();
    await page.getByTestId("cancel-unsaved-document").click();
    await expect(page.getByTestId("document-editor-step")).toBeVisible();
    await page.getByTestId("document-editor-save").click();
    await expect(page.getByText("Saved to Documents")).toBeVisible();
    await page.getByTestId("document-editor-continue").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toHaveCount(0);
    await expect(page.getByTestId("available-workflows-panel")).toBeVisible();
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
    if (previousTestAIResponse === undefined) {
      delete process.env.MATTER_LAYER_TEST_EXTRACTION_AI_RESPONSE;
    } else {
      process.env.MATTER_LAYER_TEST_EXTRACTION_AI_RESPONSE = previousTestAIResponse;
    }
    await server.stop();
  }
});
