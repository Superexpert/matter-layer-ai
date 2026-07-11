export type AIProviderModel = {
  description?: string;
  family?: string;
  id: string;
  label: string;
  supportedReasoningEfforts?: readonly ReasoningEffort[];
  supportsReasoning?: boolean;
  supportsStructuredOutput?: boolean;
  supportsTemperature?: boolean;
};

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";

export type AIProviderRegistration = {
  id: "openai" | "anthropic" | "ollama";
  name: string;
  defaultModel: string;
  models: AIProviderModel[];
  apiKeyLabel?: string;
  baseUrlLabel?: string;
  defaultBaseUrl?: string;
  supportsDynamicModels?: boolean;
  requiresApiKey: boolean;
};

export const AI_PROVIDER_REGISTRY = [
  {
    apiKeyLabel: "OpenAI API Key",
    defaultModel: "gpt-5.5",
    id: "openai",
    models: [
      {
        description: "Highest-capability GPT-5.6 model for complex analysis and demanding workflows. Availability depends on the OpenAI account.",
        family: "gpt-5.6",
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        supportedReasoningEfforts: REASONING_EFFORTS,
        supportsReasoning: true,
        supportsStructuredOutput: true,
        supportsTemperature: false,
      },
      {
        description: "Balanced GPT-5.6 model for capability, speed, and cost. Availability depends on the OpenAI account.",
        family: "gpt-5.6",
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        supportedReasoningEfforts: REASONING_EFFORTS,
        supportsReasoning: true,
        supportsStructuredOutput: true,
        supportsTemperature: false,
      },
      {
        description: "Fastest and lowest-cost GPT-5.6 model. Availability depends on the OpenAI account.",
        family: "gpt-5.6",
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        supportedReasoningEfforts: REASONING_EFFORTS,
        supportsReasoning: true,
        supportsStructuredOutput: true,
        supportsTemperature: false,
      },
      {
        id: "gpt-5.5",
        label: "GPT-5.5",
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
      },
      {
        id: "gpt-5.4-nano",
        label: "GPT-5.4 nano",
      },
    ],
    name: "OpenAI",
    requiresApiKey: true,
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
    requiresApiKey: true,
  },
  {
    baseUrlLabel: "Ollama server URL",
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
    defaultModel: "",
    id: "ollama",
    models: [],
    name: "Ollama Local",
    requiresApiKey: false,
    supportsDynamicModels: true,
  },
] as const satisfies readonly AIProviderRegistration[];

export type AIProviderId = (typeof AI_PROVIDER_REGISTRY)[number]["id"];

export function getAIProviderRegistration(
  providerId: string,
): AIProviderRegistration | undefined {
  return (AI_PROVIDER_REGISTRY as readonly AIProviderRegistration[]).find(
    (provider) => provider.id === providerId,
  );
}

export function isRegisteredAIProvider(
  providerId: string,
): providerId is AIProviderId {
  return Boolean(getAIProviderRegistration(providerId));
}

export function isRegisteredAIModel(providerId: string, modelId: string) {
  const provider = getAIProviderRegistration(providerId);

  if (provider?.supportsDynamicModels) {
    return modelId.trim().length > 0;
  }

  return Boolean(provider?.models.some((model) => model.id === modelId));
}

export function getAIProviderModel(providerId: string, modelId: string) {
  return getAIProviderRegistration(providerId)?.models.find((model) => model.id === modelId);
}
