import type { SetupCheckResult } from "../setup-types";

const OPENAI_PROVIDER = "openai";
const OPENAI_REQUIRED_ENV_VARS = ["OPENAI_API_KEY", "AI_OPENAI_MODEL"] as const;

export function checkAIProviderSetup(
  env: NodeJS.ProcessEnv = process.env,
): SetupCheckResult {
  const provider = env.AI_PROVIDER?.trim();

  if (!provider) {
    return {
      area: "ai-provider",
      missingEnvVars: ["AI_PROVIDER"],
      status: "missing",
      message: "AI_PROVIDER is missing.",
    };
  }

  if (provider !== OPENAI_PROVIDER) {
    return {
      area: "ai-provider",
      missingEnvVars: [],
      status: "invalid",
      message: `AI_PROVIDER is set to "${provider}", but only "openai" is currently implemented.`,
    };
  }

  const missingEnvVars = OPENAI_REQUIRED_ENV_VARS.filter(
    (name) => !env[name]?.trim(),
  );

  return {
    area: "ai-provider",
    missingEnvVars,
    status: missingEnvVars.length > 0 ? "missing" : "ready",
    message:
      missingEnvVars.length > 0
        ? "OpenAI provider configuration is incomplete."
        : undefined,
  };
}
