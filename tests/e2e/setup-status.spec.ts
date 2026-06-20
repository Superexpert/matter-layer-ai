import { expect, test } from "@playwright/test";

import { addTestAuthSession, startNextTestServer } from "./next-test-server";

test.describe.configure({ mode: "serial" });

test("redirects protected app routes to database setup when DATABASE_URL is missing", async ({
  page,
}) => {
  const server = await startNextTestServer({ databaseUrl: "", port: 3250 });

  try {
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/settings`);

    await expect(page).toHaveURL(`${server.baseURL}/setup/database`);
    await expect(page.getByTestId("database-setup-instructions")).toBeVisible();
    await expect(page.getByTestId("missing-database-env-var")).toContainText(
      "DATABASE_URL",
    );
  } finally {
    await server.stop();
  }
});
