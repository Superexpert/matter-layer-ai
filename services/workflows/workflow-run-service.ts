import "server-only";

import { WorkflowRunStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { markdownToEditorHtml } from "@/workflow-steps/document-editor/conversion";
import { createWorkflowArtifactRevision } from "./workflow-artifact-service";

export type WorkflowRunWorkProductSummary = {
  createdAt: string;
  description: string | null;
  id: string;
  title: string;
  updatedAt: string;
};

export type WorkflowRunSummary = {
  completedAt: string | null;
  createdAt: string;
  id: string;
  inputCaseFileCount: number;
  status: "running" | "completed" | "failed";
  updatedAt: string;
  workflowName: string;
  workProducts: WorkflowRunWorkProductSummary[];
};

export type WorkflowRunDetails = WorkflowRunSummary & {
  activities: Array<{
    code: string;
    createdAt: string;
    id: string;
    level: string;
    message: string;
    stepId: string;
  }>;
  aiProvider: string | null;
  errors: string[];
  inputCaseFiles: Array<{
    fileName: string;
    id: string;
  }>;
  stepOutputs: Array<{
    createdAt: string;
    stepId: string;
    updatedAt: string;
  }>;
  workflowDefinitionId: string;
};

export type EditableWorkflowArtifact = {
  artifactId: string;
  contentMarkdown: string;
  editorContentHtml: string;
  title: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function artifactDescription(title: string, metadata: unknown) {
  if (isObjectRecord(metadata) && typeof metadata.description === "string") {
    return metadata.description;
  }

  if (title === "Chronology") {
    return "Generated chronology of events from selected case files.";
  }

  if (title === "Lawyer Memo") {
    return "Attorney-facing analysis generated from selected case files.";
  }

  if (title === "Client Summary") {
    return "Plain-language client-facing summary generated from selected case files.";
  }

  return null;
}

function runStatus(status: WorkflowRunStatus): WorkflowRunSummary["status"] {
  if (status === WorkflowRunStatus.completed) {
    return "completed";
  }

  if (status === WorkflowRunStatus.failed) {
    return "failed";
  }

  return "running";
}

function workflowNameFromCatalog(
  workflowDefinitionId: string,
  catalog: Map<string, { name: string }>,
) {
  const workflow = catalog.get(workflowDefinitionId);

  if (!workflow) {
    throw new Error(`Workflow definition was not found: ${workflowDefinitionId}`);
  }

  return workflow.name;
}

async function workflowCatalogForRuns(workflowDefinitionIds: string[]) {
  const workflows = await prisma.workflow.findMany({
    select: {
      definitionJson: true,
      name: true,
      slug: true,
    },
  });
  const requestedIds = new Set(workflowDefinitionIds);
  const catalog = new Map<string, { name: string }>();

  for (const workflow of workflows) {
    if (requestedIds.has(workflow.slug)) {
      catalog.set(workflow.slug, {
        name: workflow.name,
      });
    }

    const definition = workflow.definitionJson;
    if (isObjectRecord(definition) && typeof definition.id === "string") {
      catalog.set(definition.id, {
        name: workflow.name,
      });
    }
  }

  return catalog;
}

function toSummary(
  run: {
    artifacts: Array<{
      createdAt: Date;
      id: string;
      metadataJson: unknown;
      title: string;
      updatedAt: Date;
    }>;
    createdAt: Date;
    id: string;
    selectedFiles: Array<{ matterDocumentId: string }>;
    status: WorkflowRunStatus;
    updatedAt: Date;
    workflowDefinitionId: string;
  },
  catalog: Map<string, { name: string }>,
): WorkflowRunSummary {
  return {
    completedAt:
      run.status === WorkflowRunStatus.completed ? run.updatedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
    id: run.id,
    inputCaseFileCount: new Set(
      run.selectedFiles.map((file) => file.matterDocumentId),
    ).size,
    status: runStatus(run.status),
    updatedAt: run.updatedAt.toISOString(),
    workflowName: workflowNameFromCatalog(run.workflowDefinitionId, catalog),
    workProducts: run.artifacts.map((artifact) => ({
      createdAt: artifact.createdAt.toISOString(),
      description: artifactDescription(artifact.title, artifact.metadataJson),
      id: artifact.id,
      title: artifact.title,
      updatedAt: artifact.updatedAt.toISOString(),
    })),
  };
}

export async function listWorkflowRunSummaries(input: {
  matterId: string;
}): Promise<WorkflowRunSummary[]> {
  const runs = await prisma.workflowRun.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      artifacts: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          createdAt: true,
          id: true,
          metadataJson: true,
          title: true,
          updatedAt: true,
        },
      },
      createdAt: true,
      id: true,
      selectedFiles: {
        select: {
          matterDocumentId: true,
        },
      },
      status: true,
      updatedAt: true,
      workflowDefinitionId: true,
    },
    where: {
      matterId: input.matterId,
    },
  });
  const catalog = await workflowCatalogForRuns(
    runs.map((run) => run.workflowDefinitionId),
  );

  return runs.map((run) => toSummary(run, catalog));
}

export async function getWorkflowRunDetails(input: {
  matterId: string;
  workflowRunId: string;
}): Promise<WorkflowRunDetails> {
  const run = await prisma.workflowRun.findUnique({
    select: {
      artifacts: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          createdAt: true,
          id: true,
          metadataJson: true,
          title: true,
          updatedAt: true,
        },
      },
      createdAt: true,
      extractionRuns: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          error: true,
          metadataJson: true,
        },
      },
      id: true,
      selectedFiles: {
        select: {
          matterDocument: {
            select: {
              fileName: true,
              id: true,
            },
          },
          matterDocumentId: true,
        },
      },
      status: true,
      stepActivities: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          code: true,
          createdAt: true,
          id: true,
          level: true,
          message: true,
          stepId: true,
        },
      },
      stepOutputs: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          createdAt: true,
          stepId: true,
          updatedAt: true,
        },
      },
      updatedAt: true,
      workflowDefinitionId: true,
    },
    where: {
      id: input.workflowRunId,
    },
  });

  if (!run || run.id !== input.workflowRunId) {
    throw new Error("Workflow run was not found.");
  }

  const ownership = await prisma.workflowRun.findUnique({
    select: {
      matterId: true,
    },
    where: {
      id: input.workflowRunId,
    },
  });

  if (!ownership || ownership.matterId !== input.matterId) {
    throw new Error("Workflow run does not belong to the current matter.");
  }

  const catalog = await workflowCatalogForRuns([run.workflowDefinitionId]);
  const summary = toSummary(run, catalog);
  const aiProvider = run.extractionRuns
    .map((extractionRun) => {
      const metadata = extractionRun.metadataJson;

      return isObjectRecord(metadata) && typeof metadata.aiProvider === "string"
        ? metadata.aiProvider
        : null;
    })
    .find((provider): provider is string => typeof provider === "string") ?? null;

  return {
    ...summary,
    activities: run.stepActivities.map((activity) => ({
      code: activity.code,
      createdAt: activity.createdAt.toISOString(),
      id: activity.id,
      level: activity.level,
      message: activity.message,
      stepId: activity.stepId,
    })),
    aiProvider,
    errors: run.extractionRuns
      .map((extractionRun) => extractionRun.error)
      .filter((error): error is string => Boolean(error)),
    inputCaseFiles: Array.from(
      new Map(
        run.selectedFiles.map((file) => [
          file.matterDocument.id,
          {
            fileName: file.matterDocument.fileName,
            id: file.matterDocument.id,
          },
        ]),
      ).values(),
    ),
    stepOutputs: run.stepOutputs.map((output) => ({
      createdAt: output.createdAt.toISOString(),
      stepId: output.stepId,
      updatedAt: output.updatedAt.toISOString(),
    })),
    workflowDefinitionId: run.workflowDefinitionId,
  };
}

export async function completeWorkflowRun(input: {
  matterId: string;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  const run = await prisma.workflowRun.findUnique({
    select: {
      matterId: true,
      status: true,
      workflowDefinitionId: true,
    },
    where: {
      id: input.workflowRunId,
    },
  });

  if (!run) {
    throw new Error("Workflow run was not found.");
  }

  if (
    run.matterId !== input.matterId ||
    run.workflowDefinitionId !== input.workflowDefinitionId
  ) {
    throw new Error("Workflow run does not belong to the current matter.");
  }

  await prisma.workflowRun.update({
    data: {
      status: WorkflowRunStatus.completed,
    },
    where: {
      id: input.workflowRunId,
    },
  });
}

export async function getEditableWorkflowArtifact(input: {
  artifactId: string;
  matterId: string;
  workflowRunId: string;
}): Promise<EditableWorkflowArtifact> {
  const artifact = await prisma.workflowArtifact.findUnique({
    select: {
      content: true,
      currentRevision: {
        select: {
          content: true,
        },
      },
      id: true,
      matterId: true,
      title: true,
      workflowRunId: true,
    },
    where: {
      id: input.artifactId,
    },
  });

  if (!artifact) {
    throw new Error("Work product was not found.");
  }

  if (
    artifact.matterId !== input.matterId ||
    artifact.workflowRunId !== input.workflowRunId
  ) {
    throw new Error("Work product does not belong to the current workflow run.");
  }

  const contentMarkdown = artifact.currentRevision?.content ?? artifact.content ?? "";

  if (!contentMarkdown.trim()) {
    throw new Error("Work product content was not found.");
  }

  return {
    artifactId: artifact.id,
    contentMarkdown,
    editorContentHtml: markdownToEditorHtml(contentMarkdown),
    title: artifact.title,
  };
}

export async function saveWorkflowArtifactEdits(input: {
  artifactId: string;
  contentMarkdown: string;
  editorJson?: unknown;
  matterId: string;
  userId?: string | null;
  workflowRunId: string;
}) {
  if (!input.contentMarkdown.trim()) {
    throw new Error("Work product content cannot be empty.");
  }

  const artifact = await prisma.workflowArtifact.findUnique({
    select: {
      id: true,
      matterId: true,
      stepId: true,
      workflowRunId: true,
    },
    where: {
      id: input.artifactId,
    },
  });

  if (!artifact) {
    throw new Error("Work product was not found.");
  }

  if (
    artifact.matterId !== input.matterId ||
    artifact.workflowRunId !== input.workflowRunId
  ) {
    throw new Error("Work product does not belong to the current workflow run.");
  }

  await createWorkflowArtifactRevision({
    artifactId: artifact.id,
    content: input.contentMarkdown,
    editorJson: input.editorJson,
    matterId: input.matterId,
    stepId: artifact.stepId,
    userId: input.userId ?? null,
    workflowRunId: input.workflowRunId,
  });

  return getEditableWorkflowArtifact(input);
}
