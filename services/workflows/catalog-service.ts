import { Prisma, WorkflowSource } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { builtInWorkflows } from "@/workflows";

import { isWorkflowDefinition, validateWorkflowDefinitionDraft } from "./validation";
import { savedWorkflowFromDraft } from "./workflow-builder-service";
import type {
  BuiltInWorkflowDefinition,
  WorkflowCatalogItem,
  WorkflowCatalogSource,
  WorkflowDefinition,
} from "./types";

type WorkflowPromotionExport = {
  slug: string;
  builtInVersion: number;
  isSystem: boolean;
  isEnabledByDefault: boolean;
  definition: WorkflowDefinition;
};

function assertValidWorkflowDefinition(workflow: WorkflowDefinition) {
  const validation = validateWorkflowDefinitionDraft(workflow);

  if (!validation.valid) {
    throw new Error(`Invalid workflow definition: ${validation.messages.join(" ")}`);
  }
}

function assertValidBuiltInWorkflow(workflow: BuiltInWorkflowDefinition) {
  if (!workflow.slug.trim()) {
    throw new Error(`Built-in workflow ${workflow.definition.id} must have a slug.`);
  }

  if (!Number.isInteger(workflow.builtInVersion) || workflow.builtInVersion < 1) {
    throw new Error(
      `Built-in workflow ${workflow.slug} must have a positive builtInVersion.`,
    );
  }

  assertValidWorkflowDefinition(workflow.definition);
}

function workflowDefinitionToJson(workflow: WorkflowDefinition): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(workflow)) as Prisma.InputJsonValue;
}

function workflowDefinitionFromJson(value: Prisma.JsonValue): WorkflowDefinition {
  if (!isWorkflowDefinition(value)) {
    throw new Error("Workflow row contains an invalid WorkflowDefinition.");
  }

  const workflow = value as WorkflowDefinition;

  assertValidWorkflowDefinition(workflow);
  return {
    ...workflow,
    steps: workflow.steps.map((step) => ({
      ...step,
      parameters: { ...step.parameters },
    })),
  };
}

function workflowCatalogSourceFromPrisma(source: WorkflowSource): WorkflowCatalogSource {
  if (source === WorkflowSource.builtIn) {
    return "builtIn";
  }

  if (source === WorkflowSource.custom) {
    return "custom";
  }

  throw new Error(`Unsupported workflow source: ${source}`);
}

function workflowCatalogItemFromRow(workflow: {
  definitionJson: Prisma.JsonValue;
  source: WorkflowSource;
}): WorkflowCatalogItem {
  const source = workflowCatalogSourceFromPrisma(workflow.source);

  return {
    ...workflowDefinitionFromJson(workflow.definitionJson),
    isBuiltIn: source === "builtIn",
    source,
  };
}

export function slugFromWorkflowName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error("Workflow name must contain at least one slug character.");
  }

  return slug;
}

export async function syncBuiltInWorkflows() {
  const syncedWorkflows: WorkflowDefinition[] = [];

  for (const builtInWorkflow of builtInWorkflows) {
    assertValidBuiltInWorkflow(builtInWorkflow);

    const existingWorkflow = await prisma.workflow.findUnique({
      select: {
        source: true,
      },
      where: {
        slug: builtInWorkflow.slug,
      },
    });

    if (existingWorkflow?.source === WorkflowSource.custom) {
      throw new Error(
        `Cannot sync built-in workflow "${builtInWorkflow.slug}" because a custom workflow already uses that slug.`,
      );
    }

    const workflow = await prisma.workflow.upsert({
      create: {
        builtInVersion: builtInWorkflow.builtInVersion,
        definitionJson: workflowDefinitionToJson(builtInWorkflow.definition),
        description: builtInWorkflow.definition.description,
        isEnabled: builtInWorkflow.isEnabledByDefault,
        isSystem: builtInWorkflow.isSystem,
        name: builtInWorkflow.definition.name,
        slug: builtInWorkflow.slug,
        source: WorkflowSource.builtIn,
      },
      update: {
        builtInVersion: builtInWorkflow.builtInVersion,
        definitionJson: workflowDefinitionToJson(builtInWorkflow.definition),
        description: builtInWorkflow.definition.description,
        isSystem: builtInWorkflow.isSystem,
        name: builtInWorkflow.definition.name,
        source: WorkflowSource.builtIn,
      },
      where: {
        slug: builtInWorkflow.slug,
      },
    });

    syncedWorkflows.push(workflowDefinitionFromJson(workflow.definitionJson));
  }

  return syncedWorkflows;
}

export async function listEnabledWorkflowDefinitions() {
  const workflowCatalog = await listEnabledWorkflowCatalog();

  return workflowCatalog.map((workflow) => ({
    description: workflow.description,
    id: workflow.id,
    name: workflow.name,
    steps: workflow.steps,
  }));
}

export async function listEnabledWorkflowCatalog() {
  const workflowRows = await prisma.workflow.findMany({
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
      source: true,
    },
    where: {
      isEnabled: true,
    },
  });

  return workflowRows.map(workflowCatalogItemFromRow);
}

async function createUniqueWorkflowSlug(baseSlug: string) {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
    const existingWorkflow = await prisma.workflow.findUnique({
      select: {
        id: true,
      },
      where: {
        slug,
      },
    });

    if (!existingWorkflow) {
      return slug;
    }
  }

  throw new Error(`Could not create a unique workflow slug for "${baseSlug}".`);
}

export async function createCustomWorkflow(
  draftWorkflow: WorkflowDefinition,
  userId: string | null,
) {
  assertValidWorkflowDefinition(draftWorkflow);

  const baseSlug = slugFromWorkflowName(draftWorkflow.name);
  const slug = await createUniqueWorkflowSlug(baseSlug);
  const workflowDefinition = {
    ...savedWorkflowFromDraft(draftWorkflow),
    id: slug,
  };

  assertValidWorkflowDefinition(workflowDefinition);

  const workflow = await prisma.workflow.create({
    data: {
      builtInVersion: null,
      createdByUserId: userId,
      definitionJson: workflowDefinitionToJson(workflowDefinition),
      description: workflowDefinition.description,
      isEnabled: true,
      isSystem: false,
      name: workflowDefinition.name,
      slug,
      source: WorkflowSource.custom,
      updatedByUserId: userId,
    },
  });

  return workflowDefinitionFromJson(workflow.definitionJson);
}

export async function duplicateWorkflow(slug: string, userId: string | null) {
  const workflow = await prisma.workflow.findUnique({
    select: {
      definitionJson: true,
      name: true,
    },
    where: {
      slug,
    },
  });

  if (!workflow) {
    throw new Error(`Workflow "${slug}" does not exist.`);
  }

  const workflowDefinition = workflowDefinitionFromJson(workflow.definitionJson);
  const duplicatedWorkflow = await createCustomWorkflow(
    {
      ...workflowDefinition,
      id: "draft-workflow",
      name: `Copy of ${workflow.name}`,
    },
    userId,
  );

  return getWorkflowCatalogItem(duplicatedWorkflow.id);
}

export async function deleteCustomWorkflow(slug: string) {
  const workflow = await prisma.workflow.findUnique({
    select: {
      source: true,
    },
    where: {
      slug,
    },
  });

  if (!workflow) {
    throw new Error(`Workflow "${slug}" does not exist.`);
  }

  if (workflow.source === WorkflowSource.builtIn) {
    throw new Error("Built-in workflows cannot be deleted.");
  }

  if (workflow.source !== WorkflowSource.custom) {
    throw new Error(`Unsupported workflow source: ${workflow.source}`);
  }

  await prisma.workflow.delete({
    where: {
      slug,
    },
  });
}

export async function getWorkflowCatalogItem(slug: string) {
  const workflow = await prisma.workflow.findUnique({
    select: {
      definitionJson: true,
      source: true,
    },
    where: {
      slug,
    },
  });

  if (!workflow) {
    throw new Error(`Workflow "${slug}" does not exist.`);
  }

  return workflowCatalogItemFromRow(workflow);
}

export async function exportWorkflowForBuiltIn(slug: string) {
  const workflow = await prisma.workflow.findUnique({
    select: {
      definitionJson: true,
      isSystem: true,
      slug: true,
    },
    where: {
      slug,
    },
  });

  if (!workflow) {
    throw new Error(`Workflow "${slug}" does not exist.`);
  }

  const definition = workflowDefinitionFromJson(workflow.definitionJson);
  const workflowExport: WorkflowPromotionExport = {
    builtInVersion: 1,
    definition,
    isEnabledByDefault: true,
    isSystem: workflow.isSystem,
    slug: workflow.slug,
  };

  return JSON.stringify(workflowExport, null, 2);
}
