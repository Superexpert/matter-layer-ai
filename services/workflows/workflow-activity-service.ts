import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type WorkflowActivityLevel =
  | "debug"
  | "info"
  | "warning"
  | "error"
  | "success";

export type WorkflowActivityEvent = {
  code: string;
  documentId?: string;
  documentName?: string;
  id: string;
  level: WorkflowActivityLevel;
  message: string;
  metadata?: Record<string, unknown>;
  stepId: string;
  timestamp: string;
  workflowRunId: string;
};

export type EmitWorkflowActivityInput = {
  code: string;
  documentId?: string;
  documentName?: string;
  level: WorkflowActivityLevel;
  message: string;
  metadata?: Record<string, unknown>;
  stepId: string;
  workflowRunId: string;
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toActivityEvent(row: {
  code: string;
  createdAt: Date;
  documentId: string | null;
  documentName: string | null;
  id: string;
  level: string;
  message: string;
  metadataJson: Prisma.JsonValue | null;
  stepId: string;
  workflowRunId: string;
}): WorkflowActivityEvent {
  return {
    code: row.code,
    documentId: row.documentId ?? undefined,
    documentName: row.documentName ?? undefined,
    id: row.id,
    level: row.level as WorkflowActivityLevel,
    message: row.message,
    metadata: row.metadataJson && typeof row.metadataJson === "object" && !Array.isArray(row.metadataJson)
      ? (row.metadataJson as Record<string, unknown>)
      : undefined,
    stepId: row.stepId,
    timestamp: row.createdAt.toISOString(),
    workflowRunId: row.workflowRunId,
  };
}

export async function emitWorkflowActivityEvent(
  input: EmitWorkflowActivityInput,
): Promise<WorkflowActivityEvent> {
  const row = await prisma.workflowRunStepActivity.create({
    data: {
      code: input.code,
      documentId: input.documentId,
      documentName: input.documentName,
      level: input.level,
      message: input.message,
      metadataJson: input.metadata ? toJson(input.metadata) : undefined,
      stepId: input.stepId,
      workflowRunId: input.workflowRunId,
    },
  });

  return toActivityEvent(row);
}

export async function listWorkflowStepActivityEvents(input: {
  stepId: string;
  workflowRunId: string;
}): Promise<WorkflowActivityEvent[]> {
  const rows = await prisma.workflowRunStepActivity.findMany({
    orderBy: [
      {
        createdAt: "asc",
      },
      {
        id: "asc",
      },
    ],
    where: {
      stepId: input.stepId,
      workflowRunId: input.workflowRunId,
    },
  });

  return rows.map(toActivityEvent);
}

export async function clearWorkflowStepActivityEvents(input: {
  stepId: string;
  workflowRunId: string;
}) {
  await prisma.workflowRunStepActivity.deleteMany({
    where: {
      stepId: input.stepId,
      workflowRunId: input.workflowRunId,
    },
  });
}
