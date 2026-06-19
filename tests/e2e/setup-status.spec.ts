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

test("redirects protected app routes to AI setup when AI_PROVIDER is missing", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL for setup health checks.");

  const server = await startNextTestServer({
    aiProvider: "",
    databaseUrl: process.env.DATABASE_URL,
    port: 3251,
  });

  try {
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/settings`);

    await expect(page).toHaveURL(`${server.baseURL}/setup/ai-provider`);
    await expect(page.getByTestId("ai-provider-setup-instructions")).toBeVisible();
    await expect(page.getByTestId("missing-ai-env-var")).toContainText(
      "AI_PROVIDER",
    );
  } finally {
    await server.stop();
  }
});

test("shows missing OPENAI_API_KEY when OpenAI provider is incomplete", async ({
  page,
}) => {
  const server = await startNextTestServer({
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    openAIAPIKey: "",
    port: 3252,
  });

  try {
    await page.goto(`${server.baseURL}/setup/ai-provider`);

    await expect(page.getByTestId("ai-provider-setup-instructions")).toBeVisible();
    await expect(page.getByTestId("missing-ai-env-var")).toContainText(
      "OPENAI_API_KEY",
    );
  } finally {
    await server.stop();
  }
});

test("shows missing AI_OPENAI_MODEL when OpenAI model is missing", async ({
  page,
}) => {
  const server = await startNextTestServer({
    aiOpenAIModel: "",
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    port: 3253,
  });

  try {
    await page.goto(`${server.baseURL}/setup/ai-provider`);

    await expect(page.getByTestId("ai-provider-setup-instructions")).toBeVisible();
    await expect(page.getByTestId("missing-ai-env-var")).toContainText(
      "AI_OPENAI_MODEL",
    );
  } finally {
    await server.stop();
  }
});

test("shows unsupported AI provider message without exposing secrets", async ({
  page,
}) => {
  const server = await startNextTestServer({
    aiProvider: "anthropic",
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    openAIAPIKey: "secret-value-that-should-not-render",
    port: 3254,
  });

  try {
    await page.goto(`${server.baseURL}/setup/ai-provider`);

    await expect(page.getByText('AI_PROVIDER is set to "anthropic"')).toBeVisible();
    await expect(
      page.getByText("secret-value-that-should-not-render"),
    ).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
