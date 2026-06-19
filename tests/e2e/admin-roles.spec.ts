import { PrismaClient, UserRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { addTestAuthSession, startNextTestServer } from "./next-test-server";

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
