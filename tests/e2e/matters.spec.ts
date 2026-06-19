import { expect, test } from "@playwright/test";

import { addTestAuthSession, startNextTestServer } from "./next-test-server";

test.describe.configure({ mode: "serial" });

test("authenticated user can create a matter", async ({ page }) => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const server = await startNextTestServer({ port: 3220 });
  const matterName = `Test Matter ${Date.now()}`;

  try {
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
    await expect(
      page.getByRole("heading", { name: matterName }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Start working on this matter" }),
    ).toBeVisible();
    await expect(page.getByTestId("message-textarea")).toHaveAttribute(
      "placeholder",
      "Message Matter Layer...",
    );
    await expect(page.getByTestId("send-message-button")).toBeVisible();
  } finally {
    await server.stop();
  }
});
