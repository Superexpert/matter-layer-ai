import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

export function assertTestDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl?.trim()) {
    throw new Error("Tests require DATABASE_URL in .env.test.local.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const databaseName = parsedUrl.pathname.replace(/^\/+/, "");
  const searchableUrl = `${parsedUrl.hostname}/${databaseName}`.toLowerCase();

  if (!searchableUrl.includes("test")) {
    throw new Error(
      `Refusing to run database tests against non-test database "${databaseName}". DATABASE_URL must clearly contain "test".`,
    );
  }
}

export async function resetTestDatabase() {
  assertTestDatabaseUrl(process.env.DATABASE_URL);

  const dbPush = spawnSync(
    "./node_modules/.bin/prisma",
    ["db", "push", "--force-reset", "--skip-generate"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );

  if (dbPush.status !== 0) {
    throw new Error(`Prisma db push failed with exit code ${dbPush.status}.`);
  }

  const prisma = new PrismaClient();

  try {
    await prisma.workflowRunStepFile.deleteMany();
    await prisma.workflowRunStepOutput.deleteMany();
    await prisma.workflowExtractionRun.deleteMany();
    await prisma.workflowRun.deleteMany();
    await prisma.matterDocumentRepresentation.deleteMany();
    await prisma.matterDocument.deleteMany();
    await prisma.workflow.deleteMany();
    await prisma.matter.deleteMany();
    await prisma.aiProviderConfig.deleteMany();
    await prisma.appSettings.deleteMany({
      where: {
        id: "app",
      },
    });
    await prisma.user.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}
