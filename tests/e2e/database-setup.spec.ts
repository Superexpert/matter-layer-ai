import { expect, test } from "@playwright/test";

import { addTestAuthSession, startNextTestServer } from "./next-test-server";

test.describe.configure({ mode: "serial" });

test("shows database setup instructions when DATABASE_URL is missing", async ({
  page,
}) => {
  const server = await startNextTestServer({ databaseUrl: "", port: 3230 });

  try {
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/matters`);

    await expect(page.getByTestId("database-setup-instructions")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Database setup required" }),
    ).toBeVisible();
    await expect(page.getByText("DATABASE_URL").first()).toBeVisible();
    await expect(page.getByText("postgresql://")).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("does not show database setup instructions when DATABASE_URL is present", async ({
  page,
}) => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3231,
  });

  try {
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/matters`);

    await expect(page.getByTestId("database-setup-instructions")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Matters" })).toBeVisible();
  } finally {
    await server.stop();
  }
});
