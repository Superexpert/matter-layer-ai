import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, expect, test } from "vitest";

import {
  effectiveWorkflowStepProvider,
  resolveWorkflowStepAIProvider,
  saveWorkflowStepSetting,
} from "../../services/workflows/workflow-step-settings-service";
import { syncBuiltInWorkflows } from "../../services/workflows/catalog-service";
import { getAdminWorkflowDetailWithSettings } from "../../services/workflows/admin-workflow-catalog";
import { extractionStep } from "../../workflow-steps/extraction/definition";
import {
  createExtractionAIService,
  loadExtractionStepState,
} from "../../workflow-steps/extraction/server";
import type { ConfiguredAISettings } from "../../services/ai/ai-settings-service";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.workflowStepSetting.deleteMany();
  await prisma.aiProviderConfig.deleteMany();
  await syncBuiltInWorkflows();
});

async function createProvider(input: {
  isActive: boolean;
  model: string;
  provider: string;
}) {
  return prisma.aiProviderConfig.create({
    data: {
      apiKey: "test-key",
      isActive: input.isActive,
      model: input.model,
      provider: input.provider,
    },
  });
}

test("Extraction step registers an AI Provider admin setting", () => {
  expect(extractionStep.adminSettings).toMatchObject([
    {
      defaultValue: null,
      key: "aiProviderId",
      label: "AI Provider",
      type: "aiProvider",
    },
  ]);
});

test("workflow detail includes registered step settings", async () => {
  const detail = await getAdminWorkflowDetailWithSettings("chronology");
  const extractionStepDetail = detail?.steps.find(
    (step) => step.id === "extract-chronology",
  );

  expect(extractionStepDetail?.adminSettings).toMatchObject([
    {
      definition: {
        key: "aiProviderId",
        label: "AI Provider",
        type: "aiProvider",
      },
      isPersisted: false,
      value: null,
      warning: null,
    },
  ]);
});

test("saving a workflow step setting persists the value", async () => {
  const provider = await createProvider({
    isActive: true,
    model: "gpt-5.5",
    provider: "openai",
  });

  await saveWorkflowStepSetting({
    rawValue: provider.id,
    settingKey: "aiProviderId",
    stepId: "extract-chronology",
    workflowId: "chronology",
  });

  const row = await prisma.workflowStepSetting.findUniqueOrThrow({
    where: {
      workflowId_stepId_settingKey: {
        settingKey: "aiProviderId",
        stepId: "extract-chronology",
        workflowId: "chronology",
      },
    },
  });

  expect(row.valueJson).toBe(provider.id);
});

test("AI Provider setting resolution uses override, default, and stale fallback", async () => {
  const defaultProvider = await createProvider({
    isActive: true,
    model: "gpt-5.5",
    provider: "openai",
  });
  const overrideProvider = await createProvider({
    isActive: false,
    model: "sonnet-4",
    provider: "anthropic",
  });

  await expect(
    resolveWorkflowStepAIProvider({
      stepId: "extract-chronology",
      workflowId: "chronology",
    }),
  ).resolves.toMatchObject({
    settings: {
      model: "gpt-5.5",
      provider: "openai",
    },
    source: "default",
  });

  await saveWorkflowStepSetting({
    rawValue: overrideProvider.id,
    settingKey: "aiProviderId",
    stepId: "extract-chronology",
    workflowId: "chronology",
  });

  await expect(
    resolveWorkflowStepAIProvider({
      stepId: "extract-chronology",
      workflowId: "chronology",
    }),
  ).resolves.toMatchObject({
    settings: {
      model: "sonnet-4",
      provider: "anthropic",
    },
    source: "override",
  });

  await prisma.workflowStepSetting.update({
    data: {
      valueJson: "missing-provider-id" as Prisma.InputJsonValue,
    },
    where: {
      workflowId_stepId_settingKey: {
        settingKey: "aiProviderId",
        stepId: "extract-chronology",
        workflowId: "chronology",
      },
    },
  });

  await expect(
    resolveWorkflowStepAIProvider({
      stepId: "extract-chronology",
      workflowId: "chronology",
    }),
  ).resolves.toMatchObject({
    settings: {
      model: defaultProvider.model,
      provider: defaultProvider.provider,
    },
    source: "fallback",
    warning: "The selected AI Provider no longer exists. The app default was used.",
  });
});

test("effective provider display uses default, override, stale fallback, and missing states", async () => {
  const defaultProvider = await createProvider({
    isActive: true,
    model: "gpt-5.5",
    provider: "openai",
  });
  const overrideProvider = await createProvider({
    isActive: false,
    model: "sonnet-4",
    provider: "anthropic",
  });

  await expect(
    effectiveWorkflowStepProvider({
      stepId: "extract-chronology",
      workflowId: "chronology",
    }),
  ).resolves.toMatchObject({
    modelName: "GPT-5.5",
    providerName: "OpenAI",
    source: "default",
    warning: null,
  });

  await saveWorkflowStepSetting({
    rawValue: overrideProvider.id,
    settingKey: "aiProviderId",
    stepId: "extract-chronology",
    workflowId: "chronology",
  });

  await expect(
    effectiveWorkflowStepProvider({
      stepId: "extract-chronology",
      workflowId: "chronology",
    }),
  ).resolves.toMatchObject({
    modelName: "Claude Sonnet 4",
    providerName: "Anthropic",
    source: "step-override",
    warning: null,
  });

  await prisma.workflowStepSetting.update({
    data: {
      valueJson: "missing-provider-id" as Prisma.InputJsonValue,
    },
    where: {
      workflowId_stepId_settingKey: {
        settingKey: "aiProviderId",
        stepId: "extract-chronology",
        workflowId: "chronology",
      },
    },
  });

  await expect(
    effectiveWorkflowStepProvider({
      stepId: "extract-chronology",
      workflowId: "chronology",
    }),
  ).resolves.toMatchObject({
    modelName: "GPT-5.5",
    providerName: "OpenAI",
    source: "default",
    warning: "AI Provider unavailable, using default",
  });

  await prisma.workflowStepSetting.deleteMany();
  await prisma.aiProviderConfig.deleteMany({
    where: {
      id: defaultProvider.id,
    },
  });

  await expect(
    effectiveWorkflowStepProvider({
      stepId: "extract-chronology",
      workflowId: "chronology",
    }),
  ).resolves.toEqual({
    modelName: null,
    providerId: null,
    providerName: null,
    source: "missing",
    warning: "No AI Provider configured",
  });
});

test("Extraction step state includes the effective provider display info", async () => {
  await createProvider({
    isActive: true,
    model: "gpt-5.5",
    provider: "openai",
  });
  const matter = await prisma.matter.create({
    data: {
      name: "Provider indicator matter",
    },
  });
  const workflowRun = await prisma.workflowRun.create({
    data: {
      id: `provider-indicator-${Date.now()}`,
      matterId: matter.id,
      workflowDefinitionId: "chronology",
    },
  });

  try {
    await expect(
      loadExtractionStepState({
        matterId: matter.id,
        step: {
          id: "extract-chronology",
          name: "Prepare source documents",
          parameters: {
            inputStepId: "select-source-files",
            profile: "chronology",
            representationType: "MARKDOWN",
          },
          type: "extraction",
        },
        workflowDefinitionId: "chronology",
        workflowRunId: workflowRun.id,
      }),
    ).resolves.toMatchObject({
      effectiveAIProvider: {
        modelName: "GPT-5.5",
        providerName: "OpenAI",
        source: "default",
      },
    });
  } finally {
    await prisma.workflowRun.delete({
      where: {
        id: workflowRun.id,
      },
    });
    await prisma.matter.delete({
      where: {
        id: matter.id,
      },
    });
  }
});

test("Extraction AI service factory receives the step-level override when configured", async () => {
  await createProvider({
    isActive: true,
    model: "gpt-5.5",
    provider: "openai",
  });
  const overrideProvider = await createProvider({
    isActive: false,
    model: "sonnet-4",
    provider: "anthropic",
  });
  await saveWorkflowStepSetting({
    rawValue: overrideProvider.id,
    settingKey: "aiProviderId",
    stepId: "extract-chronology",
    workflowId: "chronology",
  });
  let receivedSettings: ConfiguredAISettings | null = null;

  const aiService = await createExtractionAIService({
    aiServiceFactory: (settings) => {
      receivedSettings = settings;

      return {
        generateText: async () => ({
          content: "{}",
          model: settings.model,
          provider: settings.provider,
        }),
      };
    },
    matterId: "matter",
    step: {
      id: "extract-chronology",
      name: "Prepare source documents",
      parameters: {
        inputStepId: "select-source-files",
        profile: "chronology",
        representationType: "MARKDOWN",
      },
      type: "extraction",
    },
    workflowDefinitionId: "chronology",
    workflowRunId: "run",
  });

  expect(receivedSettings).toMatchObject({
    model: "sonnet-4",
    provider: "anthropic",
  });
  await expect(
    aiService?.generateText({
      messages: [{ content: "test", role: "user" }],
    }),
  ).resolves.toMatchObject({
    model: "sonnet-4",
    provider: "anthropic",
  });
});
