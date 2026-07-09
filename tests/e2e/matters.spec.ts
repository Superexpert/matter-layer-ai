import { expect, test } from "@playwright/test";
import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  MatterDocumentSourceType,
  PrismaClient,
  WorkflowSource,
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

test("authenticated user can create a matter", async ({ page }) => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );
  test.skip(
    true,
    "Legacy matter journey still exercises the hidden Chat tab and mixed Documents tab.",
  );

  const server = await startNextTestServer({ port: 3220 });
  const matterName = `Test Matter ${Date.now()}`;

  try {
    await prisma.workflow.deleteMany({
      where: {
        slug: {
          startsWith: "copy-of-workflow-builder",
        },
        source: WorkflowSource.custom,
      },
    });
    await seedTestAISettings();
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/matters`);

    await expect(page.getByRole("heading", { name: "Matters" })).toBeVisible();
    await expect(page.getByTestId("new-matter-button")).toBeVisible();

    await page.getByTestId("new-matter-button").click();
    await expect(page.getByTestId("new-matter-form")).toBeVisible();

    await page.getByTestId("matter-name-input").fill(matterName);
    await page.getByTestId("create-matter-submit").click();

    await expect(page.getByTestId("matters-list")).toContainText(matterName);

    const [createdMatter, currentUser] = await Promise.all([
      prisma.matter.findFirstOrThrow({
        where: {
          name: matterName,
        },
      }),
      prisma.user.findUniqueOrThrow({
        where: {
          email: "lawyer@smithlaw.com",
        },
      }),
    ]);
    const sourceDocument = await prisma.matterDocument.create({
      data: {
        fileName: "01_Incident_Report_Officer_Alvarez_v2.pdf",
        matterId: createdMatter.id,
        mimeType: "application/pdf",
        representations: {
          create: {
            content: [
              "# Incident Report",
              "",
              "<!-- ml:page {\"page\":1} -->",
              "",
              "Officer Alvarez documented the January 12, 2024 event.",
            ].join("\n"),
            metadataJson: {
              source: "extraction",
            },
            status: MatterDocumentRepresentationStatus.READY,
            type: MatterDocumentRepresentationType.MARKDOWN,
          },
        },
        size: 3686,
        sourceType: MatterDocumentSourceType.upload,
        storageProvider: "database",
        uploadedByUserId: currentUser.id,
      },
    });
    const workProductDocument = await prisma.matterDocument.create({
      data: {
        fileName: "Chronology.md",
        matterId: createdMatter.id,
        mimeType: "text/markdown",
        representations: {
          create: {
            content: [
              "# Chronology",
              "",
              "## January 12, 2024",
              "",
              "The chronology event occurred.",
              "",
              `<span data-ml-citation="true" data-citation-label="Incident Report p. 1" data-citation-printable-text="(Incident Report, p. 1)" data-citation-source-document-id="${sourceDocument.id}" data-citation-source-document-name="Incident Report" data-citation-page="1">Incident Report p. 1</span>`,
            ].join("\n"),
            metadataJson: {
              source: "workflow_output",
              stepId: "review-chronology",
              workflowDefinitionId: "chronology",
              workflowRunId: "documents-tab-action-test-run",
            },
            status: MatterDocumentRepresentationStatus.READY,
            type: MatterDocumentRepresentationType.MARKDOWN,
          },
        },
        size: 841,
        sourceType: MatterDocumentSourceType.upload,
        storageProvider: "database",
        uploadedByUserId: currentUser.id,
      },
    });

    await page.getByRole("link", { name: matterName }).click();

    await expect(page.getByTestId("matter-chat")).toBeVisible();
    await expect(page.getByTestId("matter-workspace-header")).toContainText(
      "Matter Layer",
    );
    await expect(page.getByTestId("matter-workspace-header")).toContainText(
      "Settings",
    );
    await expect(page.getByTestId("matter-workspace-header")).toContainText(
      "Log out",
    );
    await expect(page.getByTestId("logout-button")).toBeVisible();
    await expect(page.getByTestId("matter-selector")).toHaveCount(0);
    await expect(page.getByTestId("matter-breadcrumb")).toContainText("Matters");
    await expect(page.getByTestId("breadcrumb-current-matter")).toContainText(
      matterName,
    );
    await expect(page.getByText("Selected matter", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("matter-context-panel")).toContainText(
      matterName,
    );
    await expect(page.getByTestId("matter-tab-workflows")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("matter-tab-chat")).toBeVisible();
    await expect(page.getByTestId("matter-tab-documents")).toBeVisible();
    await expect(
      page.getByTestId("matter-tabs").getByRole("button"),
    ).toHaveText(["Workflows", "Chat", "Documents"]);
    const matterLayerBox = await page
      .getByTestId("matter-workspace-header")
      .getByRole("link", { name: "Matter Layer" })
      .boundingBox();
    const breadcrumbHomeBox = await page
      .getByTestId("breadcrumb-home")
      .boundingBox();
    const workflowsTabBox = await page
      .getByTestId("matter-tab-workflows")
      .boundingBox();
    const chatPanelBox = await page
      .getByTestId("chat-workspace-panel")
      .boundingBox();

    expect(matterLayerBox).not.toBeNull();
    expect(breadcrumbHomeBox).not.toBeNull();
    expect(workflowsTabBox).not.toBeNull();
    expect(chatPanelBox).not.toBeNull();
    expect(Math.abs(matterLayerBox!.x - breadcrumbHomeBox!.x)).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(breadcrumbHomeBox!.x - workflowsTabBox!.x),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(workflowsTabBox!.x - chatPanelBox!.x)).toBeLessThanOrEqual(
      1,
    );
    await expect(page.getByText("Ask Matter Layer")).toHaveCount(0);
    await expect(
      page.getByText(
        "Ask a question, draft a document, or start a workflow for this matter.",
      ),
    ).toHaveCount(0);
    await expect(page.getByText("Ask about this matter")).toHaveCount(0);
    await expect(page.getByText("Start a workflow")).toHaveCount(0);
    await expect(page.getByText("Add documents")).toHaveCount(0);
    await expect(
      page.getByText(
        "Matter Layer can only use information from the selected matter.",
      ),
    ).toHaveCount(0);
    await expect(page.getByTestId("message-textarea")).toHaveCount(0);
    await expect(page.getByTestId("message-composer")).toHaveCount(0);
    await expect(page.getByTestId("send-message-button")).toHaveCount(0);
    await expect(page.getByTestId("available-workflows-panel")).toContainText(
      "Available workflows",
    );
    await expect(page.getByTestId("available-workflows-panel")).toContainText(
      "Workflow Builder",
    );
    await expect(page.getByTestId("available-workflows-panel")).toContainText(
      "Start workflow",
    );
    await expect(page.getByTestId("available-workflows-canvas")).toContainText(
      "Select a workflow to begin.",
    );

    await page.getByTestId("workflow-overflow-workflow-builder").click();
    await expect(page.getByTestId("workflow-menu-workflow-builder")).toBeVisible();
    await expect(page.getByTestId("workflow-menu-edit-workflow-builder")).toContainText(
      "Edit workflow",
    );
    await expect(
      page.getByTestId("workflow-menu-duplicate-workflow-builder"),
    ).toContainText("Duplicate workflow");
    await expect(page.getByTestId("workflow-menu-delete-workflow-builder")).toHaveCount(
      0,
    );

    await page.getByTestId("workflow-menu-duplicate-workflow-builder").click();
    const duplicatedWorkflowCard = page
      .locator('[data-testid^="available-workflow-card-"]')
      .filter({ hasText: "Copy of Workflow Builder" })
      .first();

    await expect(duplicatedWorkflowCard).toBeVisible();
    await duplicatedWorkflowCard
      .getByRole("button", { name: "Workflow actions for Copy of Workflow Builder" })
      .click();
    await expect(duplicatedWorkflowCard.getByText("Edit workflow")).toBeVisible();
    await expect(duplicatedWorkflowCard.getByText("Duplicate workflow")).toBeVisible();
    await expect(duplicatedWorkflowCard.getByText("Delete workflow")).toBeVisible();
    await duplicatedWorkflowCard.getByText("Delete workflow").click();
    await expect(page.getByTestId("delete-workflow-dialog")).toContainText(
      "Delete Copy of Workflow Builder?",
    );
    await expect(page.getByTestId("delete-workflow-dialog")).toContainText(
      "This action cannot be undone.",
    );
    await page.getByTestId("cancel-delete-workflow").click();
    await expect(page.getByTestId("delete-workflow-dialog")).toHaveCount(0);
    await expect(duplicatedWorkflowCard).toBeVisible();

    await duplicatedWorkflowCard
      .getByRole("button", { name: "Workflow actions for Copy of Workflow Builder" })
      .click();
    await duplicatedWorkflowCard.getByText("Delete workflow").click();
    await page.getByTestId("confirm-delete-workflow").click();
    await expect(page.getByTestId("delete-workflow-dialog")).toHaveCount(0);
    await expect(duplicatedWorkflowCard).toHaveCount(0);

    await page.getByTestId("matter-tab-chat").click();
    await expect(page.getByTestId("matter-tab-chat")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Ask about this matter")).toBeVisible();
    await expect(page.getByText("Start a workflow")).toBeVisible();
    await expect(page.getByText("Add documents")).toBeVisible();
    await expect(page.getByTestId("message-textarea")).toHaveAttribute(
      "placeholder",
      "Message Matter Layer...",
    );
    await expect(page.getByTestId("message-textarea")).toHaveAttribute(
      "rows",
      "6",
    );
    await expect(page.getByTestId("message-textarea")).toHaveCSS(
      "resize",
      "none",
    );
    await expect(page.getByTestId("send-message-button")).toBeVisible();

    await page.getByTestId("matter-tab-documents").click();
    await expect(page.getByTestId("matter-tab-documents")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("documents-work-product-section")).toContainText(
      "Work Product",
    );
    await expect(
      page.getByTestId("documents-source-documents-section"),
    ).toContainText("Source Documents");
    const workProductCard = page.getByTestId(
      `matter-document-${workProductDocument.id}`,
    );
    const sourceDocumentCard = page.getByTestId(
      `matter-document-${sourceDocument.id}`,
    );

    await expect(workProductCard).toContainText("Chronology");
    await expect(workProductCard).not.toContainText("Chronology.md");
    await expect(workProductCard).toContainText("Updated");
    await expect(workProductCard).not.toContainText("841 B");
    await expect(
      page.getByTestId(`matter-document-edit-${workProductDocument.id}`),
    ).toContainText("Edit");
    await expect(
      page.getByTestId(`matter-document-delete-${workProductDocument.id}`),
    ).toContainText("Delete");
    await expect(sourceDocumentCard).toContainText(
      "01_Incident_Report_Officer_Alvarez_v2.pdf",
    );
    await expect(sourceDocumentCard).toContainText("Updated");
    await expect(sourceDocumentCard).not.toContainText("3.6 KB");
    await expect(
      page.getByTestId(`matter-document-edit-${sourceDocument.id}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`matter-document-delete-${sourceDocument.id}`),
    ).toContainText("Delete");
    await page.getByTestId(`matter-document-delete-${workProductDocument.id}`).click();
    await expect(page.getByTestId("delete-document-dialog")).toContainText(
      "Delete document?",
    );
    await expect(page.getByTestId("delete-document-dialog")).toContainText(
      "This will permanently delete this document from the matter. This action cannot be undone.",
    );
    await page.getByTestId("cancel-delete-document").click();
    await expect(page.getByTestId("delete-document-dialog")).toHaveCount(0);
    await expect(workProductCard).toBeVisible();
    const workProductAfterCancel = await prisma.matterDocument.findUnique({
      where: {
        id: workProductDocument.id,
      },
    });

    expect(workProductAfterCancel).not.toBeNull();

    await page.getByTestId(`matter-document-edit-${workProductDocument.id}`).click();
    await expect(page.getByTestId("documents-edit-view")).toContainText(
      "Chronology",
    );
    await expect(page.getByTestId("documents-edit-view")).not.toContainText(
      "Chronology.md",
    );
    await expect(page.getByTestId("documents-edit-view")).toContainText(
      "Save",
    );
    await expect(page.getByTestId("documents-edit-view")).toContainText(
      "Export",
    );
    await expect(page.getByTestId("documents-edit-view")).toContainText(
      "Done",
    );
    await expect(page.getByTestId("documents-edit-view")).not.toContainText(
      "Save changes",
    );
    await expect(page.getByTestId("documents-edit-view")).not.toContainText(
      "Export DOCX",
    );
    await expect(page.getByTestId("documents-edit-view")).not.toContainText(
      "Back to Documents",
    );
    await expect(page.getByTestId("document-editor-content")).toContainText(
      "January 12, 2024",
    );
    await expect(
      page
        .getByTestId("document-editor-content")
        .locator(".ProseMirror"),
    ).toHaveClass(/document-editor/);
    await expect(
      page
        .getByTestId("document-editor-content")
        .locator(".document-citation-chip"),
    ).toContainText("Incident Report p. 1");
    await page
      .getByTestId("document-editor-content")
      .locator(".document-citation-chip")
      .click();
    await expect(page.getByTestId("citation-source-modal")).toBeVisible();
    await expect(page.getByTestId("citation-source-modal-content")).toContainText(
      "Officer Alvarez documented the January 12, 2024 event.",
    );
    await page.getByTestId("citation-source-modal-close").click();
    await expect(page.getByTestId("citation-source-modal")).toHaveCount(0);
    const existingDocumentDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("document-editor-export-docx").click();
    await existingDocumentDownloadPromise;
    await expect(page.getByTestId("documents-edit-view")).toBeVisible();
    await page
      .getByTestId("document-editor-content")
      .locator('[contenteditable="true"]')
      .click();
    await page.keyboard.type(" Edited from Documents tab.");
    await page.getByTestId("document-editor-continue").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toContainText(
      "Unsaved document changes",
    );
    await page.getByTestId("cancel-unsaved-document").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toHaveCount(0);
    await expect(page.getByTestId("documents-edit-view")).toBeVisible();
    await page.getByTestId("document-editor-save").click();
    await expect(page.getByText("Saved")).toBeVisible();
    const savedWorkProduct = await prisma.matterDocumentRepresentation.findUnique({
      where: {
        matterDocumentId_type: {
          matterDocumentId: workProductDocument.id,
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
    });

    expect(savedWorkProduct?.content).toContain("Edited from Documents tab.");
    expect(savedWorkProduct?.content).toContain("data-citation-source-document-id");
    expect(savedWorkProduct?.content).toContain("(Incident Report, p. 1)");
    await page.getByTestId("document-editor-continue").click();
    await expect(page.getByTestId("unsaved-document-dialog")).toHaveCount(0);
    await expect(page.getByTestId("documents-list")).toBeVisible();

    await page.getByTestId(`matter-document-delete-${sourceDocument.id}`).click();
    await expect(page.getByTestId("delete-document-dialog")).toContainText(
      "Delete document?",
    );
    await page.getByTestId("confirm-delete-document").click();
    await expect(page.getByTestId("delete-document-dialog")).toHaveCount(0);
    await expect(sourceDocumentCard).toHaveCount(0);
    const sourceDocumentAfterDelete = await prisma.matterDocument.findUnique({
      where: {
        id: sourceDocument.id,
      },
    });

    expect(sourceDocumentAfterDelete).toBeNull();
    await expect(page.getByTestId("matter-tab-documents")).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByTestId(`matter-document-delete-${workProductDocument.id}`).click();
    await expect(page.getByTestId("delete-document-dialog")).toContainText(
      "Delete document?",
    );
    await page.getByTestId("confirm-delete-document").click();
    await expect(page.getByTestId("delete-document-dialog")).toHaveCount(0);
    await expect(workProductCard).toHaveCount(0);
    const workProductAfterDelete = await prisma.matterDocument.findUnique({
      where: {
        id: workProductDocument.id,
      },
    });

    expect(workProductAfterDelete).toBeNull();
    await expect(page.getByTestId("documents-work-product-empty")).toBeVisible();
    await expect(page.getByTestId("documents-source-documents-empty")).toBeVisible();

    await page.getByTestId("matter-tab-workflows").click();
    await expect(page.getByTestId("matter-tab-workflows")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("message-textarea")).toHaveCount(0);

    let resolveFirstChatRequest: (() => void) | undefined;
    let chatRequestCount = 0;
    const streamEvents = (...events: object[]) =>
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

    await page.route("**/api/ai/chat", async (route) => {
      chatRequestCount += 1;

      if (chatRequestCount === 1) {
        const requestBody = route.request().postDataJSON() as {
          activeWorkflow?: unknown;
        };

        expect(requestBody.activeWorkflow).toBeUndefined();

        await new Promise<void>((resolve) => {
          resolveFirstChatRequest = resolve;
        });

        await route.fulfill({
          body: streamEvents(
            {
              delta: "Hello",
              type: "text-delta",
            },
            {
              delta: " streamed response",
              type: "text-delta",
            },
            {
              message: {
                content: "Hello streamed response",
                model: "test-model",
                provider: "openai",
                role: "assistant",
              },
              type: "done",
            },
          ),
          contentType: "text/event-stream; charset=utf-8",
          status: 200,
        });
        return;
      }

      await route.fulfill({
        body: [
          'data: {"type":"error","error":"Test stream failure."}',
          "",
        ].join("\n"),
        contentType: "text/event-stream; charset=utf-8",
        status: 200,
      });
    });

    await page.getByTestId("workflow-chip-workflow-builder").click();
    await expect(page.getByTestId("active-workflow-canvas")).toContainText(
      "Workflow Builder",
    );
    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Current step:",
    );
    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Work Product Canvas",
    );
    await expect(page.getByTestId("workflow-define-goal-panel")).toContainText(
      "Describe the business outcome",
    );
    await expect(page.getByTestId("workflow-preview-empty")).toContainText(
      "No workflow drafted yet",
    );
    await page.getByTestId("matter-tab-workflows").click();
    await expect(page.getByTestId("available-workflows-panel")).toContainText(
      "Available workflows",
    );
    await expect(page.getByTestId("workflow-define-goal-panel")).toHaveCount(0);

    await page.getByTestId("workflow-chip-workflow-builder").click();
    await expect(page.getByTestId("workflow-define-goal-panel")).toContainText(
      "Describe the business outcome",
    );
    await expect(
      page
        .getByTestId("active-workflow-canvas")
        .getByTestId("workflow-goal-form"),
    ).toHaveCount(0);
    await page
      .getByTestId("workflow-goal-input")
      .fill("Draft an Original Petition for Divorce.");
    await page.getByTestId("workflow-goal-submit").click();

    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Current step:",
    );
    await expect(page.getByTestId("workflow-generate-draft-panel")).toContainText(
      "Generating draft",
    );
    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Current step:",
    );
    await expect(page.getByTestId("workflow-editor-panel")).toBeVisible();
    await expect(
      page
        .getByTestId("active-workflow-canvas")
        .getByTestId("workflow-name-input"),
    ).toHaveCount(0);
    await expect(page.getByTestId("workflow-builder-canvas")).toContainText(
      "Original Petition for Divorce",
    );
    await expect(page.getByTestId("workflow-draft-step")).toHaveCount(4);
    await expect(page.getByTestId("workflow-draft-step").first()).toContainText(
      "Collect Petition Details",
    );
    await expect(page.getByTestId("chat-inline-choice")).toHaveCount(0);

    await page
      .getByTestId("workflow-name-input")
      .fill("Texas Original Petition for Divorce");
    await page
      .getByTestId("workflow-description-input")
      .fill("Draft, review, and save a Texas Original Petition for Divorce.");
    await page.getByTestId("workflow-add-step-fileSelector").click();
    await expect(page.getByTestId("workflow-draft-step")).toHaveCount(5);
    await page.getByTestId("workflow-step-move-up").click();
    await page.getByTestId("workflow-step-remove").click();
    await expect(page.getByTestId("workflow-draft-step")).toHaveCount(4);

    await page.getByTestId("workflow-step-select").nth(1).click();
    await page
      .getByTestId("workflow-step-name-input")
      .fill("Generate Texas Petition");
    await page
      .getByTestId("workflow-step-description-input")
      .fill("Generate a Texas divorce petition from collected facts.");
    await page
      .getByTestId("workflow-step-parameters-input")
      .fill('{"outputMode":"documentDraft","systemPrompt":"Draft a Texas divorce petition."}');
    await expect(page.getByTestId("workflow-step-parameter-error")).toHaveCount(0);
    await expect(page.getByTestId("workflow-validation")).toContainText(
      "Workflow is valid",
    );

    await page
      .getByTestId("workflow-step-parameters-input")
      .fill("not json");
    await expect(page.getByTestId("workflow-step-parameter-error")).toContainText(
      "Parameters must be valid JSON.",
    );
    await expect(page.getByTestId("workflow-save-button")).toBeDisabled();
    await page
      .getByTestId("workflow-step-parameters-input")
      .fill('{"outputMode":"documentDraft","systemPrompt":"Draft a Texas divorce petition."}');
    await expect(page.getByTestId("workflow-step-parameter-error")).toHaveCount(0);

    await page.getByTestId("workflow-save-button").click();
    await expect(page.getByTestId("active-workflow-canvas")).not.toContainText(
      "Current step:",
    );
    await expect(page.getByTestId("workflow-save-confirmation")).toContainText(
      "Workflow saved",
    );
    await expect(page.getByTestId("workflow-save-confirmation")).toContainText(
      "Texas Original Petition for Divorce",
    );

    await page.getByTestId("matter-tab-chat").click();
    await expect(page.getByTestId("matter-tab-chat")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("message-textarea")).toHaveAttribute(
      "placeholder",
      "Message Matter Layer...",
    );
    await expect(page.getByTestId("message-textarea")).toHaveAttribute(
      "rows",
      "6",
    );
    await expect(page.getByTestId("message-textarea")).toHaveCSS(
      "resize",
      "none",
    );
    await expect(page.getByTestId("send-message-button")).toBeVisible();

    await page.getByTestId("message-textarea").fill("Draft a case summary.");
    await page.getByTestId("send-message-button").click();

    await expect(page.getByTestId("chat-message-user").last()).toContainText(
      "Draft a case summary.",
    );
    await expect(page.getByTestId("chat-message-assistant").last()).toBeVisible();
    await expect(page.getByTestId("stop-streaming-button")).toBeVisible();

    resolveFirstChatRequest?.();

    await expect(page.getByTestId("chat-message-assistant").last()).toContainText(
      "Hello streamed response",
    );
    await expect(page.getByTestId("send-message-button")).toBeVisible();

    await page.getByTestId("message-textarea").fill("Trigger an error.");
    await page.getByTestId("send-message-button").click();

    await expect(page.getByTestId("chat-message-user").last()).toContainText(
      "Trigger an error.",
    );
    await expect(page.getByTestId("chat-error")).toContainText(
      "Matter Layer could not generate a response.",
    );

    await page.getByTestId("breadcrumb-home").click();
    await expect(page).toHaveURL(`${server.baseURL}/app/matters`);
    await expect(page.getByRole("heading", { name: "Matters" })).toBeVisible();
  } finally {
    await server.stop();
  }
});
