import { REQUIRED_DATABASE_ENV_VARS } from "@/lib/database/env";
import type { SetupCheckResult } from "../setup-types";

export function checkDatabaseSetup(
  env: NodeJS.ProcessEnv = process.env,
): SetupCheckResult {
  const missingEnvVars = REQUIRED_DATABASE_ENV_VARS.filter(
    (name) => !env[name]?.trim(),
  );

  return {
    area: "database",
    missingEnvVars,
    status: missingEnvVars.length > 0 ? "missing" : "ready",
    message:
      missingEnvVars.length > 0
        ? "Postgres database configuration is incomplete."
        : undefined,
  };
}
