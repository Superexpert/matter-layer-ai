import { expect, test } from "@playwright/test";

import {
  addTestAuthSession,
  seedTestAISettings,
  startNextTestServer,
} from "./next-test-server";

test.describe.configure({ mode: "serial" });

test("authenticated user can create a matter", async ({ page }) => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const server = await startNextTestServer({ port: 3220 });
  const matterName = `Test Matter ${Date.now()}`;

  try {
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
    await expect(page.getByTestId("matter-breadcrumb")).toContainText("Home");
    await expect(page.getByTestId("breadcrumb-current-matter")).toContainText(
      matterName,
    );
    await expect(page.getByText("Selected matter")).toHaveCount(0);
    await expect(page.getByTestId("matter-context-panel")).toContainText(
      matterName,
    );
    await expect(page.getByTestId("matter-tab-chat")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("matter-tab-workflows")).toBeVisible();
    await expect(page.getByTestId("matter-tab-documents")).toBeVisible();
    const matterLayerBox = await page
      .getByTestId("matter-workspace-header")
      .getByRole("link", { name: "Matter Layer" })
      .boundingBox();
    const breadcrumbHomeBox = await page
      .getByTestId("breadcrumb-home")
      .boundingBox();
    const chatTabBox = await page.getByTestId("matter-tab-chat").boundingBox();
    const chatPanelBox = await page
      .getByTestId("chat-workspace-panel")
      .boundingBox();

    expect(matterLayerBox).not.toBeNull();
    expect(breadcrumbHomeBox).not.toBeNull();
    expect(chatTabBox).not.toBeNull();
    expect(chatPanelBox).not.toBeNull();
    expect(Math.abs(matterLayerBox!.x - breadcrumbHomeBox!.x)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(breadcrumbHomeBox!.x - chatTabBox!.x)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(chatTabBox!.x - chatPanelBox!.x)).toBeLessThanOrEqual(1);
    await expect(page.getByText("Ask Matter Layer")).toHaveCount(0);
    await expect(
      page.getByText(
        "Ask a question, draft a document, or start a workflow for this matter.",
      ),
    ).toHaveCount(0);
    await expect(page.getByText("Ask about this matter")).toBeVisible();
    await expect(page.getByText("Start a workflow")).toBeVisible();
    await expect(page.getByText("Add documents")).toBeVisible();
    await expect(
      page.getByText(
        "Matter Layer can only use information from the selected matter.",
      ),
    ).toHaveCount(0);
    await expect(page.getByTestId("message-textarea")).toHaveAttribute(
      "placeholder",
      "Message Matter Layer...",
    );
    await expect(page.getByTestId("message-textarea")).toHaveAttribute(
      "rows",
      "7",
    );
    await expect(page.getByTestId("message-textarea")).toHaveCSS(
      "resize",
      "none",
    );
    await expect(page.getByTestId("send-message-button")).toBeVisible();

    let resolveFirstChatRequest: (() => void) | undefined;
    let chatRequestCount = 0;

    await page.route("**/api/ai/chat", async (route) => {
      chatRequestCount += 1;

      if (chatRequestCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstChatRequest = resolve;
        });

        await route.fulfill({
          body: [
            'data: {"type":"text-delta","delta":"Hello"}',
            "",
            'data: {"type":"text-delta","delta":" streamed response"}',
            "",
            'data: {"type":"done","message":{"role":"assistant","content":"Hello streamed response","provider":"openai","model":"test-model"}}',
            "",
          ].join("\n"),
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

    await page.getByTestId("message-textarea").fill("Draft a case summary.");
    await page.getByTestId("send-message-button").click();

    await expect(page.getByTestId("chat-message-user")).toContainText(
      "Draft a case summary.",
    );
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible();
    await expect(page.getByTestId("stop-streaming-button")).toBeVisible();

    resolveFirstChatRequest?.();

    await expect(page.getByTestId("chat-message-assistant")).toContainText(
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
