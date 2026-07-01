export type AIProviderModel = {
  id: string;
  label: string;
};

export type AIProviderRegistration = {
  id: "openai" | "anthropic";
  name: string;
  defaultModel: string;
  models: AIProviderModel[];
  apiKeyLabel: string;
};

export const AI_PROVIDER_REGISTRY = [
  {
    apiKeyLabel: "OpenAI API Key",
    defaultModel: "gpt-5.5",
    id: "openai",
    models: [
      {
        id: "gpt-5.5",
        label: "GPT-5.5",
      },
      {
        id: "gpt-5.5-mini",
        label: "GPT-5.5 mini",
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
      },
    ],
    name: "OpenAI",
  },
  {
    apiKeyLabel: "Anthropic API Key",
    defaultModel: "sonnet-4",
    id: "anthropic",
    models: [
      {
        id: "sonnet-4",
        label: "Claude Sonnet 4",
      },
    ],
    name: "Anthropic",
  },
] as const satisfies readonly AIProviderRegistration[];

export type AIProviderId = (typeof AI_PROVIDER_REGISTRY)[number]["id"];

export function getAIProviderRegistration(providerId: string) {
  return AI_PROVIDER_REGISTRY.find((provider) => provider.id === providerId);
}

export function isRegisteredAIProvider(
  providerId: string,
): providerId is AIProviderId {
  return Boolean(getAIProviderRegistration(providerId));
}

export function isRegisteredAIModel(providerId: string, modelId: string) {
  const provider = getAIProviderRegistration(providerId);

  return Boolean(provider?.models.some((model) => model.id === modelId));
}
