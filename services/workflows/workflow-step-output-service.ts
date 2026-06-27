import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function readWorkflowStepOutput(input: {
  stepId: string;
  workflowRunId: string;
}) {
  return prisma.workflowRunStepOutput.findUnique({
    select: {
      outputJson: true,
    },
    where: {
      workflowRunId_stepId: {
        stepId: input.stepId,
        workflowRunId: input.workflowRunId,
      },
    },
  });
}

export async function writeWorkflowStepOutput(input: {
  outputJson: unknown;
  stepId: string;
  workflowRunId: string;
}) {
  return prisma.workflowRunStepOutput.upsert({
    create: {
      outputJson: jsonValue(input.outputJson),
      stepId: input.stepId,
      workflowRunId: input.workflowRunId,
    },
    update: {
      outputJson: jsonValue(input.outputJson),
    },
    where: {
      workflowRunId_stepId: {
        stepId: input.stepId,
        workflowRunId: input.workflowRunId,
      },
    },
  });
}

export function toWorkflowJsonValue(value: unknown): Prisma.InputJsonValue {
  return jsonValue(value);
}
