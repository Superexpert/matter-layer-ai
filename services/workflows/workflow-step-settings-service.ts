import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  AISettingsConfigurationError,
  aiProviderConfigExists,
  getConfiguredAISettings,
  getConfiguredAISettingsById,
  type ConfiguredAISettings,
} from "@/services/ai/ai-settings-service";
import { getAIProviderRegistration } from "@/services/ai/provider-registry";

import { getWorkflowStepRegistration, isWorkflowStepType } from "./registry";
import type {
  WorkflowStepAdminSettingDefinition,
  WorkflowStepDefinition,
} from "./types";
import { getWorkflowCatalogItem } from "./catalog-service";

export class WorkflowStepSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowStepSettingError";
  }
}

export type ResolvedWorkflowStepAdminSetting = {
  definition: WorkflowStepAdminSettingDefinition;
  isPersisted: boolean;
  value: unknown;
  warning: string | null;
};

export type ResolvedWorkflowStepAIProvider = {
  settings: ConfiguredAISettings;
  source: "default" | "override" | "fallback";
  warning: string | null;
};

export type EffectiveWorkflowStepProvider = {
  modelName: string | null;
  providerId: string | null;
  providerName: string | null;
  source: "default" | "step-override" | "missing";
  warning: string | null;
};

function settingDefinitionsForStep(step: WorkflowStepDefinition) {
  if (!isWorkflowStepType(step.type)) {
    return [];
  }

  return getWorkflowStepRegistration(step.type).adminSettings ?? [];
}

export function registeredAdminSettingsForStep(step: WorkflowStepDefinition) {
  return settingDefinitionsForStep(step);
}

function settingDefinitionForStep(
  step: WorkflowStepDefinition,
  settingKey: string,
) {
  return settingDefinitionsForStep(step).find(
    (setting) => setting.key === settingKey,
  );
}

function normalizeSettingValueForDefinition(
  definition: WorkflowStepAdminSettingDefinition,
  rawValue: FormDataEntryValue | unknown,
) {
  const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;

  if (definition.type === "aiProvider") {
    if (value === "" || value === null || value === undefined || value === "default") {
      return null;
    }

    if (typeof value !== "string") {
      throw new WorkflowStepSettingError("AI Provider setting value is invalid.");
    }

    return value;
  }

  if (definition.type === "select") {
    if (typeof value !== "string") {
      throw new WorkflowStepSettingError(`${definition.label} value is invalid.`);
    }

    if (!definition.options.some((option) => option.value === value)) {
      throw new WorkflowStepSettingError(`${definition.label} option is invalid.`);
    }

    return value;
  }

  if (definition.type === "text" || definition.type === "textarea") {
    if (typeof value !== "string") {
      throw new WorkflowStepSettingError(`${definition.label} value is invalid.`);
    }

    return value;
  }

  throw new WorkflowStepSettingError("Unsupported workflow step setting type.");
}

async function workflowStepForSetting(input: {
  settingKey: string;
  stepId: string;
  workflowId: string;
}) {
  const workflow = await getWorkflowCatalogItem(input.workflowId);
  const step = workflow.steps.find((candidateStep) => candidateStep.id === input.stepId);

  if (!step) {
    throw new WorkflowStepSettingError("Workflow step was not found.");
  }

  const definition = settingDefinitionForStep(step, input.settingKey);

  if (!definition) {
    throw new WorkflowStepSettingError(
      "This workflow step does not support that setting.",
    );
  }

  return {
    definition,
    step,
    workflow,
  };
}

export async function saveWorkflowStepSetting(input: {
  rawValue: FormDataEntryValue | unknown;
  settingKey: string;
  stepId: string;
  workflowId: string;
}) {
  const { definition } = await workflowStepForSetting(input);
  const value = normalizeSettingValueForDefinition(definition, input.rawValue);

  if (
    definition.type === "aiProvider" &&
    typeof value === "string" &&
    !(await aiProviderConfigExists(value))
  ) {
    throw new WorkflowStepSettingError("Selected AI Provider was not found.");
  }

  await prisma.workflowStepSetting.upsert({
    create: {
      settingKey: input.settingKey,
      stepId: input.stepId,
      valueJson: value === null ? Prisma.JsonNull : value,
      workflowId: input.workflowId,
    },
    update: {
      valueJson: value === null ? Prisma.JsonNull : value,
    },
    where: {
      workflowId_stepId_settingKey: {
        settingKey: input.settingKey,
        stepId: input.stepId,
        workflowId: input.workflowId,
      },
    },
  });
}

function warningForSettingValue(input: {
  definition: WorkflowStepAdminSettingDefinition;
  value: unknown;
}) {
  if (input.definition.type !== "aiProvider") {
    return null;
  }

  if (input.value === null || input.value === undefined || input.value === "default") {
    return null;
  }

  if (typeof input.value !== "string") {
    return "This saved AI Provider setting is invalid. The app default will be used.";
  }

  return null;
}

export async function resolveAdminSettingsForStep(input: {
  step: WorkflowStepDefinition;
  workflowId: string;
}): Promise<ResolvedWorkflowStepAdminSetting[]> {
  const definitions = settingDefinitionsForStep(input.step);

  if (definitions.length === 0) {
    return [];
  }

  const rows = await prisma.workflowStepSetting.findMany({
    where: {
      settingKey: {
        in: definitions.map((definition) => definition.key),
      },
      stepId: input.step.id,
      workflowId: input.workflowId,
    },
  });
  const rowByKey = new Map(rows.map((row) => [row.settingKey, row]));

  return Promise.all(
    definitions.map(async (definition) => {
      const row = rowByKey.get(definition.key);
      const value = row ? row.valueJson : definition.defaultValue;
      let warning = warningForSettingValue({ definition, value });

      if (
        definition.type === "aiProvider" &&
        typeof value === "string" &&
        !(await aiProviderConfigExists(value))
      ) {
        warning = "The selected AI Provider no longer exists. The app default will be used.";
      }

      return {
        definition,
        isPersisted: Boolean(row),
        value,
        warning,
      };
    }),
  );
}

export async function resolveWorkflowStepAIProvider(input: {
  settingKey?: string;
  stepId: string;
  workflowId: string;
}): Promise<ResolvedWorkflowStepAIProvider> {
  const settingKey = input.settingKey ?? "aiProviderId";
  const row = await prisma.workflowStepSetting.findUnique({
    where: {
      workflowId_stepId_settingKey: {
        settingKey,
        stepId: input.stepId,
        workflowId: input.workflowId,
      },
    },
  });
  const configuredValue = row?.valueJson;

  if (typeof configuredValue === "string" && configuredValue.trim()) {
    const overrideSettings = await getConfiguredAISettingsById(configuredValue.trim());

    if (overrideSettings) {
      return {
        settings: overrideSettings,
        source: "override",
        warning: null,
      };
    }

    console.warn("[workflow-step-settings] stale AI Provider override ignored", {
      settingKey,
      stepId: input.stepId,
      workflowId: input.workflowId,
      configuredValue,
    });

    return {
      settings: await getConfiguredAISettings(),
      source: "fallback",
      warning: "The selected AI Provider no longer exists. The app default was used.",
    };
  }

  return {
    settings: await getConfiguredAISettings(),
    source: "default",
    warning: null,
  };
}

function displayNameForSettings(settings: ConfiguredAISettings) {
  const providerRegistration = getAIProviderRegistration(settings.provider);
  const modelRegistration = providerRegistration?.models.find(
    (model) => model.id === settings.model,
  );

  return {
    modelName: modelRegistration?.label ?? settings.model,
    providerId: settings.provider,
    providerName: providerRegistration?.name ?? settings.provider,
  };
}

export async function effectiveWorkflowStepProvider(input: {
  settingKey?: string;
  stepId: string;
  workflowId: string;
}): Promise<EffectiveWorkflowStepProvider> {
  try {
    const resolvedProvider = await resolveWorkflowStepAIProvider(input);
    const displayInfo = displayNameForSettings(resolvedProvider.settings);

    return {
      ...displayInfo,
      source:
        resolvedProvider.source === "override" ? "step-override" : "default",
      warning:
        resolvedProvider.source === "fallback"
          ? "AI Provider unavailable, using default"
          : resolvedProvider.warning,
    };
  } catch (error) {
    if (error instanceof AISettingsConfigurationError) {
      return {
        modelName: null,
        providerId: null,
        providerName: null,
        source: "missing",
        warning: "No AI Provider configured",
      };
    }

    throw error;
  }
}
