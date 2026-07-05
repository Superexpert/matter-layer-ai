import { WorkflowSource, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { getWorkflowStepRegistration, isWorkflowStepType } from "./registry";
import type {
  WorkflowCatalogSource,
  WorkflowDefinition,
  WorkflowStepAdminSettingDefinition,
  WorkflowStepDefinition,
} from "./types";
import { isWorkflowDefinition, validateWorkflowDefinitionDraft } from "./validation";
import { resolveAdminSettingsForStep } from "./workflow-step-settings-service";

export type AdminWorkflowSummary = {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  isBuiltIn: boolean;
  isSystem: boolean;
  isEnabled: boolean;
  source: WorkflowCatalogSource;
};

export type AdminWorkflowStepDetail = {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  description: string | null;
  adminSettings: AdminWorkflowStepSettingDetail[];
  configurationSummary: string[];
};

export type AdminWorkflowDetail = AdminWorkflowSummary & {
  steps: AdminWorkflowStepDetail[];
};

export type AdminWorkflowStepSettingDetail = {
  definition: WorkflowStepAdminSettingDefinition;
  isPersisted: boolean;
  value: unknown;
  warning: string | null;
};

type AdminWorkflowRow = {
  definitionJson: Prisma.JsonValue;
  isEnabled: boolean;
  isSystem: boolean;
  slug: string;
  source: WorkflowSource;
};

function workflowCatalogSourceFromPrisma(source: WorkflowSource): WorkflowCatalogSource {
  if (source === WorkflowSource.builtIn) {
    return "builtIn";
  }

  if (source === WorkflowSource.custom) {
    return "custom";
  }

  throw new Error(`Unsupported workflow source: ${source}`);
}

function workflowDefinitionFromJson(value: Prisma.JsonValue): WorkflowDefinition {
  if (!isWorkflowDefinition(value)) {
    throw new Error("Workflow row contains an invalid WorkflowDefinition.");
  }

  const workflow = value as WorkflowDefinition;
  const validation = validateWorkflowDefinitionDraft(workflow);

  if (!validation.valid) {
    throw new Error(`Invalid workflow definition: ${validation.messages.join(" ")}`);
  }

  return {
    ...workflow,
    steps: workflow.steps.map((step) => ({
      ...step,
      parameters: { ...step.parameters },
    })),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringConfigValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function titleCaseIdentifier(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function summarizeWorkflowStepConfiguration(
  step: WorkflowStepDefinition,
): string[] {
  const parameters = isObjectRecord(step.parameters) ? step.parameters : {};
  const summary: string[] = [];

  const purpose = stringConfigValue(parameters.purpose);
  if (purpose) {
    summary.push(purpose);
  }

  const inputStepId = stringConfigValue(parameters.inputStepId);
  if (inputStepId) {
    summary.push(`Uses output from ${inputStepId}.`);
  }

  const profile = stringConfigValue(parameters.profile);
  if (profile) {
    summary.push(`Extraction profile: ${titleCaseIdentifier(profile)}.`);
  }

  const outputMode = stringConfigValue(parameters.outputMode);
  if (outputMode) {
    summary.push(`AI output: ${titleCaseIdentifier(outputMode)}.`);
  }

  const documentTitle = stringConfigValue(parameters.documentTitle);
  if (documentTitle) {
    summary.push(`Document: ${documentTitle}.`);
  }

  const saveMode = stringConfigValue(parameters.saveMode);
  if (saveMode) {
    summary.push(`Save mode: ${titleCaseIdentifier(saveMode)}.`);
  }

  if (typeof parameters.allowUpload === "boolean") {
    summary.push(parameters.allowUpload ? "Allows document upload." : "Uses existing documents only.");
  }

  const minFiles = typeof parameters.minFiles === "number" ? parameters.minFiles : null;
  const maxFiles = typeof parameters.maxFiles === "number" ? parameters.maxFiles : null;
  if (minFiles !== null && maxFiles !== null) {
    summary.push(`Select ${minFiles}-${maxFiles} documents.`);
  } else if (minFiles !== null) {
    summary.push(`Select at least ${minFiles} document${minFiles === 1 ? "" : "s"}.`);
  } else if (maxFiles !== null) {
    summary.push(`Select up to ${maxFiles} documents.`);
  }

  return summary.slice(0, 4);
}

export function normalizeAdminWorkflowSummary(
  row: AdminWorkflowRow,
): AdminWorkflowSummary {
  const workflow = workflowDefinitionFromJson(row.definitionJson);
  const source = workflowCatalogSourceFromPrisma(row.source);

  return {
    description: workflow.description,
    id: row.slug,
    isBuiltIn: source === "builtIn",
    isEnabled: row.isEnabled,
    isSystem: row.isSystem,
    name: workflow.name,
    source,
    stepCount: workflow.steps.length,
  };
}

export function normalizeAdminWorkflowDetail(
  row: AdminWorkflowRow,
): AdminWorkflowDetail {
  const workflow = workflowDefinitionFromJson(row.definitionJson);
  const summary = normalizeAdminWorkflowSummary(row);

  return {
    ...summary,
    steps: workflow.steps.map((step) => {
      const typeLabel = isWorkflowStepType(step.type)
        ? getWorkflowStepRegistration(step.type).displayName
        : titleCaseIdentifier(step.type);

      return {
        adminSettings: isWorkflowStepType(step.type)
          ? (getWorkflowStepRegistration(step.type).adminSettings ?? []).map(
              (definition) => ({
                definition,
                isPersisted: false,
                value: definition.defaultValue,
                warning: null,
              }),
            )
          : [],
        configurationSummary: summarizeWorkflowStepConfiguration(step),
        description: step.description?.trim() || null,
        id: step.id,
        name: step.name.trim() || step.id || typeLabel,
        type: step.type,
        typeLabel,
      };
    }),
  };
}

export async function listAdminWorkflowSummaries() {
  const rows = await prisma.workflow.findMany({
    orderBy: [
      {
        isSystem: "desc",
      },
      {
        name: "asc",
      },
    ],
    select: {
      definitionJson: true,
      isEnabled: true,
      isSystem: true,
      slug: true,
      source: true,
    },
  });

  return rows.map(normalizeAdminWorkflowSummary);
}

export async function getAdminWorkflowDetail(workflowId: string) {
  const row = await prisma.workflow.findUnique({
    select: {
      definitionJson: true,
      isEnabled: true,
      isSystem: true,
      slug: true,
      source: true,
    },
    where: {
      slug: workflowId,
    },
  });

  return row ? normalizeAdminWorkflowDetail(row) : null;
}

export async function getAdminWorkflowDetailWithSettings(workflowId: string) {
  const row = await prisma.workflow.findUnique({
    select: {
      definitionJson: true,
      isEnabled: true,
      isSystem: true,
      slug: true,
      source: true,
    },
    where: {
      slug: workflowId,
    },
  });

  if (!row) {
    return null;
  }

  const workflow = workflowDefinitionFromJson(row.definitionJson);
  const detail = normalizeAdminWorkflowDetail(row);
  const steps = await Promise.all(
    detail.steps.map(async (stepDetail) => {
      const step = workflow.steps.find((candidateStep) => candidateStep.id === stepDetail.id);

      if (!step) {
        throw new Error(`Workflow step "${stepDetail.id}" was not found.`);
      }

      return {
        ...stepDetail,
        adminSettings: await resolveAdminSettingsForStep({
          step,
          workflowId: row.slug,
        }),
      };
    }),
  );

  return {
    ...detail,
    steps,
  };
}
