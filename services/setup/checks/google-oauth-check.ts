import { REQUIRED_AUTH_ENV_VARS } from "@/lib/auth/env";
import type { SetupCheckResult } from "../setup-types";

export function checkGoogleOAuthSetup(
  env: NodeJS.ProcessEnv = process.env,
): SetupCheckResult {
  const missingEnvVars = REQUIRED_AUTH_ENV_VARS.filter(
    (name) => !env[name]?.trim(),
  );

  return {
    area: "google-oauth",
    missingEnvVars,
    status: missingEnvVars.length > 0 ? "missing" : "ready",
    message:
      missingEnvVars.length > 0
        ? "Google OAuth configuration is incomplete."
        : undefined,
  };
}
