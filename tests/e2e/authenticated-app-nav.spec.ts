import { expect, test } from "@playwright/test";

import { addTestAuthSession, startNextTestServer } from "./next-test-server";

test.describe.configure({ mode: "serial" });

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

test("redirects unauthenticated app routes to login without showing global nav", async ({
  page,
}) => {
  const server = await startNextTestServer({
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    port: 3210,
  });

  try {
    await page.goto(`${server.baseURL}/app/matters`);

    await expect(page.getByTestId("global-app-nav")).toHaveCount(0);
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  } finally {
    await server.stop();
  }
});

test("shows global nav on matters and selects Matters", async ({ page }) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the Matter table.");

  const server = await startNextTestServer({ port: 3211 });

  try {
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/matters`);

    await expect(page.getByRole("heading", { name: "Matters" })).toBeVisible();
    await expect(page.getByTestId("global-app-nav")).toBeVisible();
    await expect(page.getByTestId("nav-matters")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("nav-settings")).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  } finally {
    await server.stop();
  }
});

test("shows global nav on settings and selects Settings", async ({ page }) => {
  const server = await startNextTestServer({
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    port: 3212,
  });

  try {
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/settings`);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("global-app-nav")).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("nav-matters")).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  } finally {
    await server.stop();
  }
});

test("redirects /app to /app/matters for authenticated users", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the Matter table.");

  const server = await startNextTestServer({ port: 3213 });

  try {
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app`);

    await expect(page).toHaveURL(`${server.baseURL}/app/matters`);
    await expect(page.getByRole("heading", { name: "Matters" })).toBeVisible();
  } finally {
    await server.stop();
  }
});
