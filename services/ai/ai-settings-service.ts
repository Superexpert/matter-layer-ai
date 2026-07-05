import "server-only";

import { prisma } from "@/lib/prisma";

import {
  getAIProviderRegistration,
  isRegisteredAIModel,
  isRegisteredAIProvider,
  type AIProviderId,
} from "./provider-registry";
import { normalizeOllamaBaseUrl } from "./providers/ollama-base-url";
import { testOllamaModel } from "./providers/ollama-setup";

const APP_SETTINGS_ID = "app";

export type AIProviderConfigSummary = {
  id: string;
  provider: AIProviderId;
  providerName: string;
  model: string;
  modelLabel: string;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  baseUrl: string | null;
  isActive: boolean;
};

export type ConfiguredAISettings = {
  provider: AIProviderId;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
};

export class AISettingsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AISettingsConfigurationError";
  }
}

function normalizeValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function encodeApiKey(apiKey: string) {
  return apiKey;
}

function decodeApiKey(apiKey: string) {
  return apiKey;
}

export function maskApiKey(apiKey: string | null | undefined) {
  const trimmedApiKey = apiKey?.trim();

  if (!trimmedApiKey) {
    return null;
  }

  if (trimmedApiKey.length <= 6) {
    return "••••••";
  }

  return `••••••${trimmedApiKey.slice(-6)}`;
}

function providerNameFor(provider: AIProviderId) {
  return getAIProviderRegistration(provider)?.name ?? provider;
}

function modelLabelFor(provider: AIProviderId, model: string) {
  return (
    getAIProviderRegistration(provider)?.models.find(
      (registeredModel) => registeredModel.id === model,
    )?.label ?? model
  );
}

function validateProviderAndModel(provider: string, model: string) {
  if (!isRegisteredAIProvider(provider)) {
    throw new AISettingsConfigurationError("Selected AI provider is not valid.");
  }

  if (!isRegisteredAIModel(provider, model)) {
    const providerRegistration = getAIProviderRegistration(provider);

    throw new AISettingsConfigurationError(
      `Selected AI model is not valid for ${providerRegistration?.name}.`,
    );
  }

  return provider;
}

function providerRequiresApiKey(provider: AIProviderId) {
  return getAIProviderRegistration(provider)?.requiresApiKey ?? true;
}

function providerRequiresBaseUrl(provider: AIProviderId) {
  return provider === "ollama";
}

async function backfillLegacyAISettingsIfNeeded() {
  const existingConfigCount = await prisma.aiProviderConfig.count();

  if (existingConfigCount > 0) {
    return;
  }

  const legacySettings = await prisma.appSettings.findUnique({
    select: {
      aiApiKey: true,
      aiModel: true,
      aiProvider: true,
    },
    where: {
      id: APP_SETTINGS_ID,
    },
  });

  const provider = legacySettings?.aiProvider?.trim();
  const model = legacySettings?.aiModel?.trim();
  const apiKey = legacySettings?.aiApiKey?.trim();

  if (!provider || !model || !apiKey) {
    return;
  }

  if (!isRegisteredAIProvider(provider) || !isRegisteredAIModel(provider, model)) {
    return;
  }

  await prisma.aiProviderConfig.create({
    data: {
      apiKey,
      baseUrl: null,
      isActive: true,
      model,
      provider,
    },
  });
}

export async function listAIProviderConfigs(): Promise<
  AIProviderConfigSummary[]
> {
  await backfillLegacyAISettingsIfNeeded();

  const configs = await prisma.aiProviderConfig.findMany({
    orderBy: [
      {
        isActive: "desc",
      },
      {
        createdAt: "asc",
      },
    ],
  });

  return configs.map((config) => {
    if (!isRegisteredAIProvider(config.provider)) {
      throw new AISettingsConfigurationError(
        `AI provider "${config.provider}" is not registered.`,
      );
    }

    return {
      apiKeyMasked: maskApiKey(config.apiKey),
      baseUrl: config.baseUrl?.trim() || null,
      hasApiKey: Boolean(config.apiKey?.trim()),
      id: config.id,
      isActive: config.isActive,
      model: config.model,
      modelLabel: modelLabelFor(config.provider, config.model),
      provider: config.provider,
      providerName: providerNameFor(config.provider),
    };
  });
}

export async function getConfiguredAISettings(): Promise<ConfiguredAISettings> {
  await backfillLegacyAISettingsIfNeeded();

  const activeConfig = await prisma.aiProviderConfig.findFirst({
    where: {
      isActive: true,
    },
  });

  const provider = activeConfig?.provider.trim();
  const model = activeConfig?.model.trim();
  const apiKey = activeConfig?.apiKey?.trim() ?? "";
  const baseUrl = activeConfig?.baseUrl?.trim() ?? "";

  if (!provider || !model) {
    throw new AISettingsConfigurationError(
      "AI provider settings have not been configured.",
    );
  }

  if (!isRegisteredAIProvider(provider)) {
    throw new AISettingsConfigurationError(
      `AI provider "${provider}" is not registered.`,
    );
  }

  if (!isRegisteredAIModel(provider, model)) {
    throw new AISettingsConfigurationError(
      `AI model "${model}" is not registered for provider "${provider}".`,
    );
  }

  if (providerRequiresApiKey(provider) && !apiKey) {
    throw new AISettingsConfigurationError(
      "AI provider settings have not been configured.",
    );
  }

  if (providerRequiresBaseUrl(provider) && !baseUrl) {
    throw new AISettingsConfigurationError(
      "AI provider settings have not been configured.",
    );
  }

  return {
    apiKey: apiKey ? decodeApiKey(apiKey) : null,
    baseUrl: baseUrl || null,
    model,
    provider,
  };
}

export async function getConfiguredAISettingsById(
  configId: string,
): Promise<ConfiguredAISettings | null> {
  await backfillLegacyAISettingsIfNeeded();

  const config = await prisma.aiProviderConfig.findUnique({
    where: {
      id: configId,
    },
  });

  if (!config) {
    return null;
  }

  const provider = config.provider.trim();
  const model = config.model.trim();
  const apiKey = config.apiKey?.trim() ?? "";
  const baseUrl = config.baseUrl?.trim() ?? "";

  if (!provider || !model) {
    throw new AISettingsConfigurationError("AI provider config is incomplete.");
  }

  if (!isRegisteredAIProvider(provider)) {
    throw new AISettingsConfigurationError(
      `AI provider "${provider}" is not registered.`,
    );
  }

  if (!isRegisteredAIModel(provider, model)) {
    throw new AISettingsConfigurationError(
      `AI model "${model}" is not registered for provider "${provider}".`,
    );
  }

  if (providerRequiresApiKey(provider) && !apiKey) {
    throw new AISettingsConfigurationError("AI provider config is incomplete.");
  }

  if (providerRequiresBaseUrl(provider) && !baseUrl) {
    throw new AISettingsConfigurationError("AI provider config is incomplete.");
  }

  return {
    apiKey: apiKey ? decodeApiKey(apiKey) : null,
    baseUrl: baseUrl || null,
    model,
    provider,
  };
}

export async function aiProviderConfigExists(configId: string) {
  await backfillLegacyAISettingsIfNeeded();

  const config = await prisma.aiProviderConfig.findUnique({
    select: {
      id: true,
    },
    where: {
      id: configId,
    },
  });

  return Boolean(config);
}

export async function requireConfiguredAISettings() {
  try {
    return await getConfiguredAISettings();
  } catch (error) {
    if (error instanceof AISettingsConfigurationError) {
      const { redirect } = await import("next/navigation");

      redirect("/app/admin");
    }

    throw error;
  }
}

export async function createAIProviderConfig(formData: FormData) {
  const provider = normalizeValue(formData.get("aiProvider"));
  const model = normalizeValue(formData.get("aiModel"));
  const apiKey = normalizeValue(formData.get("aiApiKey"));
  const rawBaseUrl = normalizeValue(formData.get("ollamaBaseUrl"));
  const registeredProvider = validateProviderAndModel(provider, model);
  const providerRegistration = getAIProviderRegistration(registeredProvider);
  let baseUrl: string | null = null;
  let encodedApiKey: string | null = null;

  if (providerRegistration?.requiresApiKey && !apiKey) {
    throw new AISettingsConfigurationError("An API key is required.");
  }

  if (providerRegistration?.requiresApiKey) {
    encodedApiKey = encodeApiKey(apiKey);
  }

  if (registeredProvider === "ollama") {
    try {
      baseUrl = normalizeOllamaBaseUrl(rawBaseUrl);
    } catch (error) {
      throw new AISettingsConfigurationError(
        error instanceof Error
          ? error.message
          : "Ollama server URL must be valid.",
      );
    }

    const testResult = await testOllamaModel({
      baseUrl,
      model,
    });

    if (!testResult.ok) {
      throw new AISettingsConfigurationError(testResult.error);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.aiProviderConfig.updateMany({
      data: {
        isActive: false,
      },
    });
    await tx.aiProviderConfig.create({
      data: {
        apiKey: encodedApiKey,
        baseUrl,
        isActive: true,
        model,
        provider: registeredProvider,
      },
    });
  });
}

function getRequiredConfigId(formData: FormData) {
  const configId = normalizeValue(formData.get("configId"));

  if (!configId) {
    throw new AISettingsConfigurationError("AI provider config id is required.");
  }

  return configId;
}

export async function activateAIProviderConfig(formData: FormData) {
  const configId = getRequiredConfigId(formData);

  await prisma.$transaction(async (tx) => {
    const config = await tx.aiProviderConfig.findUnique({
      select: {
        apiKey: true,
        baseUrl: true,
        id: true,
        model: true,
        provider: true,
      },
      where: {
        id: configId,
      },
    });

    if (!config) {
      throw new AISettingsConfigurationError("AI provider config was not found.");
    }

    const registeredProvider = validateProviderAndModel(
      config.provider,
      config.model,
    );

    if (providerRequiresApiKey(registeredProvider) && !config.apiKey?.trim()) {
      throw new AISettingsConfigurationError("An API key is required.");
    }

    if (providerRequiresBaseUrl(registeredProvider) && !config.baseUrl?.trim()) {
      throw new AISettingsConfigurationError("Ollama server URL is required.");
    }

    await tx.aiProviderConfig.updateMany({
      data: {
        isActive: false,
      },
    });
    await tx.aiProviderConfig.update({
      data: {
        isActive: true,
      },
      where: {
        id: configId,
      },
    });
  });
}

export async function deleteAIProviderConfig(formData: FormData) {
  const configId = getRequiredConfigId(formData);

  await prisma.$transaction(async (tx) => {
    const configCount = await tx.aiProviderConfig.count();

    if (configCount <= 1) {
      throw new AISettingsConfigurationError(
        "At least one AI provider must remain configured.",
      );
    }

    const config = await tx.aiProviderConfig.findUnique({
      select: {
        isActive: true,
      },
      where: {
        id: configId,
      },
    });

    if (!config) {
      throw new AISettingsConfigurationError("AI provider config was not found.");
    }

    if (config.isActive) {
      throw new AISettingsConfigurationError(
        "Activate another AI provider before deleting this one.",
      );
    }

    await tx.aiProviderConfig.delete({
      where: {
        id: configId,
      },
    });
  });
}
