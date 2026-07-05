import { PrismaClient, UserRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  addTestAuthSession,
  seedTestAISettings,
  startNextTestServer,
} from "./next-test-server";

test.describe.configure({ mode: "serial" });

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@smithlaw.com`;
}

async function seedUser(email: string, role: UserRole) {
  return prisma.user.upsert({
    create: {
      email,
      name: email,
      role,
    },
    update: {
      role,
    },
    where: {
      email,
    },
  });
}

test("first authenticated user becomes Admin when no Admin exists", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the User table.");

  const existingAdminCount = await prisma.user.count({
    where: {
      role: UserRole.ADMIN,
    },
  });

  test.skip(
    existingAdminCount > 0,
    "First-user bootstrap can only be verified when the database has no Admin users.",
  );

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3260,
  });
  const firstUserEmail = uniqueEmail("first-admin");

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: firstUserEmail,
      name: "First Admin",
    });
    await page.goto(`${server.baseURL}/app/settings`);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("First Admin created")).toBeVisible();

    const firstUser = await prisma.user.findUniqueOrThrow({
      where: {
        email: firstUserEmail,
      },
    });

    expect(firstUser.role).toBe(UserRole.ADMIN);
  } finally {
    await server.stop();
  }
});

test("later authenticated users default to User and cannot access Admin settings", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the User table.");

  await seedUser(uniqueEmail("seed-admin"), UserRole.ADMIN);

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3261,
  });
  const normalUserEmail = uniqueEmail("normal-user");

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: normalUserEmail,
      name: "Normal User",
    });
    await page.goto(`${server.baseURL}/app/settings`);

    await expect(page.getByTestId("settings-unauthorized")).toBeVisible();

    const normalUser = await prisma.user.findUniqueOrThrow({
      where: {
        email: normalUserEmail,
      },
    });

    expect(normalUser.role).toBe(UserRole.USER);
  } finally {
    await server.stop();
  }
});

test("Admin nav link is visible only to Admin users and /app/admin is protected", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the User table.");

  const adminEmail = uniqueEmail("nav-admin");
  const normalUserEmail = uniqueEmail("nav-user");
  const matter = await prisma.matter.create({
    data: {
      name: `Admin Nav Matter ${Date.now()}`,
    },
  });

  await seedUser(adminEmail, UserRole.ADMIN);
  await seedUser(normalUserEmail, UserRole.USER);
  await seedTestAISettings();

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3263,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Navigation Admin",
    });

    await page.goto(`${server.baseURL}/app/matters`);
    await expect(page.getByTestId("nav-admin")).toBeVisible();

    await page.goto(`${server.baseURL}/app/settings`);
    await expect(page.getByTestId("nav-admin")).toBeVisible();

    await page.goto(`${server.baseURL}/app/matters/${matter.id}`);
    await expect(page.getByTestId("nav-admin")).toBeVisible();

    await page.goto(`${server.baseURL}/app/admin`);
    await expect(page.getByTestId("admin-page")).toBeVisible();
    await expect(page.getByTestId("admin-header-panel")).toHaveCount(0);
    await expect(page.getByTestId("admin-context-header")).toContainText("Admin");
    await expect(page.getByTestId("admin-context-header")).toContainText(
      "Manage app-wide Matter Layer settings.",
    );
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByTestId("nav-admin")).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toBeVisible();
    await expect(page.getByTestId("logout-button")).toBeVisible();
    await expect(page.getByTestId("admin-tabs").getByRole("button")).toHaveText([
      "AI Providers",
      "Workflows",
    ]);
    await expect(page.getByTestId("admin-tab-ai-providers")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("admin-ai-providers-panel")).toBeVisible();
    await expect(page.getByTestId("admin-workspace-layout")).toBeVisible();
    await expect(page.getByTestId("admin-main-panel")).toBeVisible();
    await expect(page.getByTestId("admin-main-panel")).toContainText("ADMIN");
    await expect(page.getByTestId("admin-main-panel")).toContainText(
      "AI Providers",
    );
    await expect(page.getByTestId("admin-main-panel")).toContainText(
      "Configure the providers Matter Layer can use for chat and workflows.",
    );
    await expect(page.getByTestId("admin-side-panel")).toContainText("Canvas");
    await expect(page.getByTestId("admin-side-panel")).toContainText("Admin");
    await expect(page.getByTestId("admin-side-panel")).toContainText(
      "Configure system-wide settings for AI providers and workflows.",
    );
    await expect(page.getByTestId("ai-provider-form")).toBeVisible();
    await page.getByTestId("admin-tab-workflows").click();
    await expect(page).toHaveURL(`${server.baseURL}/app/admin?tab=workflows`);
    await expect(page.getByTestId("admin-tab-workflows")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("admin-workflows-panel")).toContainText(
      "Workflows",
    );
    await expect(page.getByTestId("admin-workflows-panel")).toContainText(
      "Workflow Builder",
    );
    await expect(page.getByTestId("admin-workflows-panel")).toContainText(
      "Chronology",
    );
    await expect(
      page.getByTestId("admin-workflow-card-chronology"),
    ).toHaveAttribute("href", "/app/admin/workflows/chronology");
    await expect(
      page.getByTestId("admin-workflow-card-chronology"),
    ).toContainText("Create a chronology from selected matter documents.");
    await expect(
      page.getByTestId("admin-workflow-card-chronology"),
    ).not.toContainText("3 steps");
    await expect(
      page.getByTestId("admin-workflow-card-workflow-builder"),
    ).not.toContainText("workflow-builder");
    await expect(
      page.getByTestId("admin-workflows-panel"),
    ).not.toContainText("Default workflow");
    await page.getByTestId("admin-workflow-card-chronology").click();
    await expect(page).toHaveURL(`${server.baseURL}/app/admin/workflows/chronology`);
    await expect(page.getByTestId("admin-workflow-detail-page")).toContainText(
      "Chronology",
    );
    await expect(page.getByTestId("admin-workflow-detail-page")).toContainText(
      "Create a chronology from selected matter documents.",
    );
    await expect(page.getByTestId("admin-workflow-step")).toHaveCount(3);
    await expect(page.getByTestId("admin-workflow-step").nth(0)).toContainText(
      "Select source documents",
    );
    await expect(page.getByTestId("admin-workflow-step").nth(1)).toContainText(
      "Prepare source documents",
    );
    await expect(page.getByTestId("admin-workflow-step").nth(1)).toContainText(
      "AI Provider",
    );
    await expect(
      page.getByTestId("admin-setting-input-extract-chronology-aiProviderId"),
    ).toContainText("Use default AI Provider");
    await expect(page.getByTestId("admin-workflow-step").nth(2)).toContainText(
      "Review chronology",
    );
    await page.goto(`${server.baseURL}/app/admin/workflows/missing-workflow`);
    await expect(page.getByTestId("admin-workflow-not-found")).toContainText(
      "Workflow not found",
    );
    await page.getByRole("link", { name: "Back to workflows" }).click();
    await expect(page).toHaveURL(`${server.baseURL}/app/admin?tab=workflows`);
    await expect(page.getByTestId("admin-tab-workflows")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("admin-workflows-panel")).toContainText(
      "Chronology",
    );
    await expect(page.getByTestId("admin-side-panel")).toContainText(
      "Review the workflow catalog.",
    );
    await expect(page.getByTestId("ai-provider-form")).toHaveCount(0);
    await page.getByTestId("admin-tab-ai-providers").click();
    await expect(page.getByTestId("admin-tab-ai-providers")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("ai-provider-form")).toBeVisible();

    await page.context().clearCookies();
    await addTestAuthSession(page, server.baseURL, {
      email: normalUserEmail,
      name: "Navigation User",
    });

    await page.goto(`${server.baseURL}/app/matters`);
    await expect(page.getByTestId("nav-admin")).toHaveCount(0);

    await page.goto(`${server.baseURL}/app/admin`);
    await expect(page).toHaveURL(`${server.baseURL}/app/admin`);
    await expect(page.getByTestId("admin-unauthorized")).toBeVisible();
    await expect(page.getByTestId("ai-provider-form")).toHaveCount(0);
    await expect(page.getByTestId("admin-page")).toHaveCount(0);

    await page.context().clearCookies();
    await page.goto(`${server.baseURL}/app/matters`);
    await expect(page.getByTestId("nav-admin")).toHaveCount(0);
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  } finally {
    await server.stop();
  }
});

test("Admin can manage multiple AI providers without exposing saved API keys", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the AiProviderConfig table.");

  const adminEmail = uniqueEmail("ai-settings-admin");

  await seedUser(adminEmail, UserRole.ADMIN);
  await prisma.aiProviderConfig.deleteMany();
  await prisma.appSettings.deleteMany({
    where: {
      id: "app",
    },
  });

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3264,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "AI Settings Admin",
    });
    await page.goto(`${server.baseURL}/app/admin`);

    await expect(page.getByTestId("ai-provider-form")).toBeVisible();
    await expect(page.getByTestId("ai-provider-select")).toContainText("OpenAI");
    await expect(page.getByTestId("ai-provider-select")).toContainText(
      "Anthropic",
    );
    await expect(page.getByTestId("ai-model-select")).toContainText("GPT-5.5");
    await expect(page.getByTestId("ai-model-select")).toContainText(
      "GPT-5.5 mini",
    );
    await expect(page.getByTestId("ai-model-select")).toContainText(
      "GPT-5.4 mini",
    );
    await expect(page.getByTestId("ai-model-select")).toHaveValue("gpt-5.5");

    await page.getByTestId("ai-provider-select").selectOption("anthropic");
    await expect(page.getByTestId("ai-model-select")).toContainText(
      "Claude Sonnet 4",
    );
    await expect(page.getByTestId("ai-model-select")).toHaveValue("sonnet-4");
    await expect(page.getByTestId("ai-model-select")).not.toContainText("GPT-5.5");

    await page.getByTestId("ai-api-key-input").fill("test-anthropic-key-123456");
    await page.getByTestId("save-ai-settings-button").click();

    await expect(page).toHaveURL(`${server.baseURL}/app/admin?saved=ai`);
    await expect(page.getByTestId("ai-settings-success")).toBeVisible();

    let configs = await prisma.aiProviderConfig.findMany({
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(configs).toHaveLength(1);
    expect(configs[0].provider).toBe("anthropic");
    expect(configs[0].model).toBe("sonnet-4");
    expect(configs[0].apiKey).toBe("test-anthropic-key-123456");
    expect(configs[0].isActive).toBe(true);
    await expect(page.getByTestId("active-provider-badge")).toHaveCount(1);
    await expect(page.getByTestId("provider-api-key-masked")).toContainText(
      "••••••123456",
    );
    await expect(page.getByText("test-anthropic-key-123456")).toHaveCount(0);
    await expect(page.getByTestId("delete-provider-button")).toBeDisabled();
    await expect(page.getByTestId("final-provider-delete-help")).toBeVisible();

    await page.getByTestId("ai-provider-select").selectOption("openai");
    await expect(page.getByTestId("ai-model-select")).toHaveValue("gpt-5.5");
    await page.getByTestId("ai-model-select").selectOption("gpt-5.5-mini");
    await page.getByTestId("ai-api-key-input").fill("test-openai-key-654321");
    await page.getByTestId("save-ai-settings-button").click();

    await expect(page).toHaveURL(`${server.baseURL}/app/admin?saved=ai`);
    await expect(page.getByTestId("ai-provider-card")).toHaveCount(2);
    configs = await prisma.aiProviderConfig.findMany({
      orderBy: {
        createdAt: "asc",
      },
    });
    expect(configs).toHaveLength(2);
    expect(configs.filter((config) => config.isActive)).toHaveLength(1);
    expect(configs.find((config) => config.isActive)?.provider).toBe("openai");
    expect(configs.find((config) => config.provider === "openai")?.model).toBe(
      "gpt-5.5-mini",
    );
    const openAICard = page
      .getByTestId("ai-provider-card")
      .filter({ hasText: "OpenAI" });

    await expect(openAICard.getByTestId("provider-model")).toContainText(
      "GPT-5.5 mini",
    );

    const anthropicCard = page
      .getByTestId("ai-provider-card")
      .filter({ hasText: "Anthropic" });
    await anthropicCard.getByTestId("activate-provider-button").click();
    await expect
      .poll(async () => {
        const activeConfig = await prisma.aiProviderConfig.findFirst({
          where: {
            isActive: true,
          },
        });

        return activeConfig?.provider;
      })
      .toBe("anthropic");

    configs = await prisma.aiProviderConfig.findMany();
    expect(configs.filter((config) => config.isActive)).toHaveLength(1);
    expect(configs.find((config) => config.isActive)?.provider).toBe(
      "anthropic",
    );

  } finally {
    await server.stop();
  }
});

test("Admin delete requires confirmation and final provider cannot be deleted", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the AiProviderConfig table.");

  const adminEmail = uniqueEmail("delete-ai-settings-admin");

  await seedUser(adminEmail, UserRole.ADMIN);
  await prisma.aiProviderConfig.deleteMany();
  await prisma.appSettings.deleteMany({
    where: {
      id: "app",
    },
  });
  await prisma.aiProviderConfig.createMany({
    data: [
      {
        apiKey: "test-anthropic-key-123456",
        isActive: true,
        model: "sonnet-4",
        provider: "anthropic",
      },
      {
        apiKey: "test-openai-key-654321",
        isActive: false,
        model: "gpt-5",
        provider: "openai",
      },
    ],
  });

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3267,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Delete AI Settings Admin",
    });
    await page.goto(`${server.baseURL}/app/admin`);

    const openAICard = page
      .getByTestId("ai-provider-card")
      .filter({ hasText: "OpenAI" });

    await expect(openAICard.getByTestId("provider-model")).toContainText("gpt-5");
    await expect(openAICard.getByTestId("delete-provider-button")).toBeEnabled();

    let confirmMessage = "";
    page.once("dialog", async (dialog) => {
      confirmMessage = dialog.message();
      await dialog.accept();
    });
    await openAICard.getByTestId("delete-provider-button").click();
    expect(confirmMessage).toBe("Delete this AI provider configuration?");

    await expect
      .poll(async () => prisma.aiProviderConfig.count())
      .toBe(1);
    await page.goto(`${server.baseURL}/app/admin`);
    await expect(page.getByTestId("delete-provider-button")).toBeDisabled();
    await expect(page.getByTestId("final-provider-delete-help")).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("homepage redirects Admin users to Admin when AI settings are missing", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the AiProviderConfig table.");

  const adminEmail = uniqueEmail("missing-home-ai-admin");

  await seedUser(adminEmail, UserRole.ADMIN);
  await prisma.aiProviderConfig.deleteMany();
  await prisma.appSettings.deleteMany({
    where: {
      id: "app",
    },
  });

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3266,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Missing Home AI Admin",
    });

    await page.goto(server.baseURL);

    await expect(page).toHaveURL(`${server.baseURL}/app/admin`);
    await expect(page.getByTestId("admin-page")).toBeVisible();
    await expect(page.getByTestId("ai-provider-form")).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("Admin AI settings reject invalid provider and model submissions", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the AiProviderConfig table.");

  const adminEmail = uniqueEmail("invalid-ai-settings-admin");

  await seedUser(adminEmail, UserRole.ADMIN);

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3265,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Invalid AI Settings Admin",
    });
    await page.goto(`${server.baseURL}/app/admin`);

    await page.evaluate(() => {
      const providerSelect = document.querySelector<HTMLSelectElement>(
        '[data-testid="ai-provider-select"]',
      );
      const invalidProviderOption = new Option("Invalid", "invalid-provider");

      providerSelect?.add(invalidProviderOption);
      if (providerSelect) {
        providerSelect.value = "invalid-provider";
        providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.getByTestId("ai-api-key-input").fill("test-invalid-key");
    await page.getByTestId("save-ai-settings-button").click();
    await expect(page.getByTestId("ai-settings-error")).toContainText(
      "Selected AI provider is not valid.",
    );

    await page.getByTestId("ai-provider-select").selectOption("openai");
    await page.evaluate(() => {
      const modelSelect = document.querySelector<HTMLSelectElement>(
        '[data-testid="ai-model-select"]',
      );
      const invalidModelOption = new Option("Invalid", "invalid-model");

      modelSelect?.add(invalidModelOption);
      if (modelSelect) {
        modelSelect.value = "invalid-model";
      }
    });
    await page.getByTestId("ai-api-key-input").fill("test-invalid-key");
    await page.getByTestId("save-ai-settings-button").click();
    await expect(page.getByTestId("ai-settings-error")).toContainText(
      "Selected AI model is not valid for OpenAI.",
    );
  } finally {
    await server.stop();
  }
});

test("Admin can grant and remove Admin role without removing the final Admin", async ({
  page,
}) => {
  test.skip(!hasDatabaseUrl, "Requires DATABASE_URL and the User table.");

  const adminEmail = uniqueEmail("admin");
  const normalUserEmail = uniqueEmail("promoted-user");

  await seedUser(adminEmail, UserRole.ADMIN);
  await seedUser(normalUserEmail, UserRole.USER);

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3262,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Role Admin",
    });
    await page.goto(`${server.baseURL}/app/settings`);

    const userRow = page.locator("tr").filter({ hasText: normalUserEmail });
    await userRow.getByTestId("grant-admin-button").click();
    await expect(userRow.getByTestId("user-role")).toContainText("ADMIN");

    let promotedUser = await prisma.user.findUniqueOrThrow({
      where: {
        email: normalUserEmail,
      },
    });
    expect(promotedUser.role).toBe(UserRole.ADMIN);

    await userRow.getByTestId("remove-admin-button").click();
    await expect(userRow.getByTestId("user-role")).toContainText("USER");

    promotedUser = await prisma.user.findUniqueOrThrow({
      where: {
        email: normalUserEmail,
      },
    });
    expect(promotedUser.role).toBe(UserRole.USER);
  } finally {
    await server.stop();
  }
});
