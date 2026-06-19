import "server-only";

import { OpenAIProvider } from "./openai-provider";

const SUPPORTED_AI_PROVIDER = "openai";

function getConfiguredProviderName(env: NodeJS.ProcessEnv = process.env) {
  const providerName = env.AI_PROVIDER?.trim();

  if (!providerName) {
    throw new Error("AI_PROVIDER is required. Supported provider: openai.");
  }

  return providerName;
}

export function createConfiguredAIProvider(
  env: NodeJS.ProcessEnv = process.env,
) {
  const providerName = getConfiguredProviderName(env);

  if (providerName !== SUPPORTED_AI_PROVIDER) {
    throw new Error(
      `AI provider "${providerName}" is not implemented. Supported provider: openai.`,
    );
  }

  return new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.AI_OPENAI_MODEL,
  });
}
