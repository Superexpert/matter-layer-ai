import "server-only";

import { Prisma } from "@prisma/client";

import type { SetupCheckResult } from "../setup-types";

export function getDatabaseNameFromUrl(databaseUrl: string | undefined) {
  if (!databaseUrl?.trim()) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));

    return databaseName || undefined;
  } catch {
    return undefined;
  }
}

function getDatabaseNameFromPrismaMessage(message: string) {
  const backtickMatch = message.match(/Database `([^`]+)` does not exist/i);

  if (backtickMatch?.[1]) {
    return backtickMatch[1];
  }

  const quotedMatch = message.match(/database "([^"]+)" does not exist/i);

  return quotedMatch?.[1];
}

export function isMissingDatabaseError(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientInitializationError &&
    error.errorCode === "P1003"
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /Database `[^`]+` does not exist/i.test(error.message) ||
    /database "[^"]+" does not exist/i.test(error.message)
  );
}

export async function checkDatabaseHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SetupCheckResult> {
  const { prisma } = await import("@/lib/prisma");

  try {
    await prisma.$queryRaw`SELECT 1`;

    return {
      area: "database",
      missingEnvVars: [],
      status: "ready",
    };
  } catch (error) {
    if (!isMissingDatabaseError(error)) {
      throw error;
    }

    const databaseName =
      error instanceof Error
        ? getDatabaseNameFromPrismaMessage(error.message) ??
          getDatabaseNameFromUrl(env.DATABASE_URL)
        : getDatabaseNameFromUrl(env.DATABASE_URL);

    return {
      area: "database",
      databaseName,
      missingEnvVars: [],
      status: "invalid",
      message: "Your DATABASE_URL points to a database that has not been created yet.",
    };
  }
}
