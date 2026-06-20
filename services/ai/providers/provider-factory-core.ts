import { AnthropicProvider } from "./anthropic-provider-core";
import { OpenAIProvider } from "./openai-provider-core";
import type { ConfiguredAISettings } from "../ai-settings-service";

const SUPPORTED_AI_PROVIDERS = ["openai", "anthropic"] as const;

export function createAIProviderFromSettings(settings: ConfiguredAISettings) {
  const providerName = settings.provider;

  if (providerName === "openai") {
    return new OpenAIProvider({
      apiKey: settings.apiKey,
      model: settings.model,
    });
  }

  if (providerName === "anthropic") {
    return new AnthropicProvider({
      apiKey: settings.apiKey,
      model: settings.model,
    });
  }

  throw new Error(
    `AI provider "${providerName}" is not implemented. Supported providers: ${SUPPORTED_AI_PROVIDERS.join(", ")}.`,
  );
}
