import { Prisma, WorkflowArtifactType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function createWorkflowMarkdownArtifact(input: {
  content: string;
  matterId: string;
  metadataJson?: unknown;
  stepId: string;
  title: string;
  workflowRunId: string;
}) {
  return prisma.workflowArtifact.create({
    data: {
      content: input.content,
      matterId: input.matterId,
      metadataJson:
        input.metadataJson === undefined ? Prisma.DbNull : jsonValue(input.metadataJson),
      stepId: input.stepId,
      title: input.title,
      type: WorkflowArtifactType.MARKDOWN,
      workflowRunId: input.workflowRunId,
    },
  });
}

export async function getWorkflowMarkdownArtifact(input: {
  artifactId: string;
  matterId: string;
  workflowRunId: string;
}) {
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
      stepId: true,
      title: true,
      type: true,
      workflowRunId: true,
    },
    where: {
      id: input.artifactId,
    },
  });

  if (!artifact) {
    throw new Error("Workflow artifact was not found.");
  }

  if (
    artifact.workflowRunId !== input.workflowRunId ||
    artifact.matterId !== input.matterId
  ) {
    throw new Error("Workflow artifact does not belong to the current matter.");
  }

  if (artifact.type !== WorkflowArtifactType.MARKDOWN) {
    throw new Error("Only Markdown workflow artifacts are supported.");
  }

  return artifact;
}

export async function createWorkflowArtifactRevision(input: {
  artifactId: string;
  content: string;
  editorJson?: unknown;
  matterId: string;
  stepId: string;
  userId?: string | null;
  workflowRunId: string;
}) {
  const revision = await prisma.workflowArtifactRevision.create({
    data: {
      artifactId: input.artifactId,
      content: input.content,
      createdByUserId: input.userId ?? null,
      editorJson:
        input.editorJson === undefined ? Prisma.DbNull : jsonValue(input.editorJson),
      matterId: input.matterId,
      stepId: input.stepId,
      workflowRunId: input.workflowRunId,
    },
  });

  await prisma.workflowArtifact.update({
    data: {
      currentRevisionId: revision.id,
      reviewedAt: new Date(),
      reviewedByUserId: input.userId ?? null,
    },
    where: {
      id: input.artifactId,
    },
  });

  return revision;
}

export async function overwriteWorkflowArtifact(input: {
  artifactId: string;
  content: string;
  userId?: string | null;
}) {
  return prisma.workflowArtifact.update({
    data: {
      content: input.content,
      reviewedAt: new Date(),
      reviewedByUserId: input.userId ?? null,
    },
    where: {
      id: input.artifactId,
    },
  });
}
