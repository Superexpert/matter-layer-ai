import { PrismaClient } from "@prisma/client";
import { afterAll, expect, test } from "vitest";

import {
  emitWorkflowActivityEvent,
  listWorkflowStepActivityEvents,
} from "../../services/workflows/workflow-activity-service";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

test("workflow activity service persists ordered events for a workflow run step", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const matter = await prisma.matter.create({
    data: {
      name: `Activity Matter ${suffix}`,
    },
  });
  const workflowRun = await prisma.workflowRun.create({
    data: {
      id: `activity-run-${suffix}`,
      matterId: matter.id,
      workflowDefinitionId: "chronology",
    },
  });

  try {
    const firstEvent = await emitWorkflowActivityEvent({
      code: "workflow.started",
      level: "info",
      message: "Started workflow step.",
      stepId: "extract-chronology",
      workflowRunId: workflowRun.id,
    });
    const secondEvent = await emitWorkflowActivityEvent({
      code: "document.loading",
      documentId: "doc_123",
      documentName: "Report.pdf",
      level: "success",
      message: "Loaded Report.pdf.",
      metadata: {
        pageCount: 2,
      },
      stepId: "extract-chronology",
      workflowRunId: workflowRun.id,
    });

    const events = await listWorkflowStepActivityEvents({
      stepId: "extract-chronology",
      workflowRunId: workflowRun.id,
    });

    expect(events.map((event) => event.id)).toEqual([
      firstEvent.id,
      secondEvent.id,
    ]);
    expect(events[1]).toMatchObject({
      code: "document.loading",
      documentId: "doc_123",
      documentName: "Report.pdf",
      level: "success",
      message: "Loaded Report.pdf.",
      metadata: {
        pageCount: 2,
      },
    });
  } finally {
    await prisma.workflowRunStepActivity.deleteMany({
      where: {
        workflowRunId: workflowRun.id,
      },
    });
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
