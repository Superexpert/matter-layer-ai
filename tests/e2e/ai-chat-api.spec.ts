import { expect, test } from "@playwright/test";
import { PrismaClient, UserRole } from "@prisma/client";

import { addTestAuthSession, startNextTestServer } from "./next-test-server";

test.describe.configure({ mode: "serial" });

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

test("rejects empty AI chat messages without calling the provider", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL and the User table.");

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3240,
  });

  try {
    await addTestAuthSession(page, server.baseURL);

    const response = await page.request.post(`${server.baseURL}/api/ai/chat`, {
      data: {
        matterId: "test-matter",
        messages: [],
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must include matterId and messages.",
    });
  } finally {
    await server.stop();
  }
});

test("returns Admin redirect when AI settings are missing", async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL and the User table.");

  const adminEmail = uniqueEmail("missing-ai-admin");

  await seedUser(adminEmail, UserRole.ADMIN);
  await prisma.aiProviderConfig.deleteMany();
  await prisma.appSettings.deleteMany({
    where: {
      id: "app",
    },
  });

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3241,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Missing AI Admin",
    });

    const response = await page.request.post(`${server.baseURL}/api/ai/chat`, {
      data: {
        matterId: "test-matter",
        messages: [
          {
            content: "Hello",
            role: "user",
          },
        ],
      },
    });

    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "AI provider settings are not configured.",
      redirectTo: "/app/admin",
    });
  } finally {
    await server.stop();
  }
});

test("returns contact-admin message for non-admin users when AI settings are missing", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL and the User table.");

  const adminEmail = uniqueEmail("existing-ai-admin");
  const userEmail = uniqueEmail("missing-ai-user");

  await seedUser(adminEmail, UserRole.ADMIN);
  await seedUser(userEmail, UserRole.USER);
  await prisma.aiProviderConfig.deleteMany();
  await prisma.appSettings.deleteMany({
    where: {
      id: "app",
    },
  });

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3242,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: userEmail,
      name: "Missing AI User",
    });

    const response = await page.request.post(`${server.baseURL}/api/ai/chat`, {
      data: {
        matterId: "test-matter",
        messages: [
          {
            content: "Hello",
            role: "user",
          },
        ],
      },
    });

    expect(response.status()).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AI has not been configured yet. Please contact an administrator.",
    });
  } finally {
    await server.stop();
  }
});
