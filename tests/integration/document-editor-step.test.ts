import { PrismaClient, WorkflowArtifactType } from "@prisma/client";
import { afterAll, expect, test } from "vitest";

import type { WorkflowStepDefinition } from "../../services/workflows/types";
import {
  loadDocumentEditorStepState,
  saveDocumentEditorArtifact,
} from "../../workflow-steps/document-editor/server";
import { documentEditorStep as registeredDocumentEditorStep } from "../../workflow-steps/document-editor/definition";
import { chronologyDefinition } from "../../workflows/chronology.workflow";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

const documentEditorStep: WorkflowStepDefinition = {
  description: "Review and edit the generated chronology.",
  id: "review-chronology",
  name: "Review chronology",
  parameters: {
    artifactOutputKey: "chronologyArtifactId",
    contentType: "MARKDOWN",
    editor: "tiptap",
    inputStepId: "extract-chronology",
    saveMode: "revision",
  },
  type: "documentEditor",
};

async function createFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `document-editor-${suffix}@example.com`,
      name: "Document Editor Lawyer",
    },
  });
  const matter = await prisma.matter.create({
    data: {
      name: `Document Editor Matter ${suffix}`,
    },
  });
  const workflowRunId = `document-editor-run-${suffix}`;

  await prisma.workflowRun.create({
    data: {
      id: workflowRunId,
      matterId: matter.id,
      workflowDefinitionId: "chronology",
    },
  });
  const artifact = await prisma.workflowArtifact.create({
    data: {
      content: "# Chronology\n\nOriginal chronology.",
      matterId: matter.id,
      metadataJson: {
        profile: "chronology",
      },
      stepId: "extract-chronology",
      title: "Chronology Draft",
      type: WorkflowArtifactType.MARKDOWN,
      workflowRunId,
    },
  });
  await prisma.workflowRunStepOutput.create({
    data: {
      outputJson: {
        chronologyArtifactId: artifact.id,
        status: "completed",
      },
      stepId: "extract-chronology",
      workflowRunId,
    },
  });

  return {
    artifact,
    matter,
    user,
    workflowRunId,
  };
}

async function cleanupMatter(matterId: string) {
  await prisma.workflowArtifact.updateMany({
    data: {
      currentRevisionId: null,
    },
    where: {
      matterId,
    },
  });
  await prisma.workflowArtifactRevision.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.workflowArtifact.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.workflowRunStepOutput.deleteMany({
    where: {
      workflowRun: {
        matterId,
      },
    },
  });
  await prisma.workflowRun.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.matter.delete({
    where: {
      id: matterId,
    },
  });
}

test("document editor step is registered", () => {
  expect(registeredDocumentEditorStep).toMatchObject({
    displayName: "Document Editor",
    type: "documentEditor",
  });
});

test("chronology workflow includes document editor after extraction", () => {
  expect(chronologyDefinition.steps.map((step) => step.type)).toEqual([
    "fileSelector",
    "extraction",
    "documentEditor",
  ]);
  expect(chronologyDefinition.steps[2]).toMatchObject({
    id: "review-chronology",
    parameters: {
      artifactOutputKey: "chronologyArtifactId",
      inputStepId: "extract-chronology",
    },
  });
});

test("document editor loads artifact from previous step output and saves a revision", async () => {
  const { artifact, matter, user, workflowRunId } = await createFixture();

  try {
    const state = await loadDocumentEditorStepState({
      matterId: matter.id,
      step: documentEditorStep,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(state).toMatchObject({
      artifactId: artifact.id,
      contentMarkdown: "# Chronology\n\nOriginal chronology.",
      saveMode: "revision",
      title: "Chronology Draft",
    });
    expect(state.editorContentHtml).toContain("<h1>Chronology</h1>");

    const output = await saveDocumentEditorArtifact({
      artifactId: artifact.id,
      contentMarkdown: "# Chronology\n\nReviewed chronology.",
      editorJson: {
        type: "doc",
      },
      matterId: matter.id,
      step: documentEditorStep,
      userId: user.id,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });

    expect(output).toMatchObject({
      reviewedArtifactId: artifact.id,
      sourceArtifactId: artifact.id,
      status: "completed",
    });
    expect("revisionId" in output ? output.revisionId : null).toEqual(expect.any(String));

    const updatedArtifact = await prisma.workflowArtifact.findUniqueOrThrow({
      where: {
        id: artifact.id,
      },
    });
    const revision = await prisma.workflowArtifactRevision.findFirstOrThrow({
      where: {
        artifactId: artifact.id,
      },
    });
    const stepOutput = await prisma.workflowRunStepOutput.findUniqueOrThrow({
      where: {
        workflowRunId_stepId: {
          stepId: documentEditorStep.id,
          workflowRunId,
        },
      },
    });

    expect(updatedArtifact.content).toBe("# Chronology\n\nOriginal chronology.");
    expect(updatedArtifact.currentRevisionId).toBe(revision.id);
    expect(revision.content).toBe("# Chronology\n\nReviewed chronology.");
    expect(stepOutput.outputJson).toMatchObject({
      revisionId: revision.id,
      sourceArtifactId: artifact.id,
      status: "completed",
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("document editor fails clearly when the configured artifact key is missing", async () => {
  const { matter, workflowRunId } = await createFixture();

  try {
    await prisma.workflowRunStepOutput.update({
      data: {
        outputJson: {
          status: "completed",
        },
      },
      where: {
        workflowRunId_stepId: {
          stepId: "extract-chronology",
          workflowRunId,
        },
      },
    });

    await expect(
      loadDocumentEditorStepState({
        matterId: matter.id,
        step: documentEditorStep,
        workflowDefinitionId: "chronology",
        workflowRunId,
      }),
    ).rejects.toThrow("chronologyArtifactId");
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("document editor rejects artifact save attempts across matters", async () => {
  const { artifact, matter, workflowRunId } = await createFixture();
  const otherMatter = await prisma.matter.create({
    data: {
      name: `Other Matter ${Date.now()}`,
    },
  });

  try {
    await expect(
      saveDocumentEditorArtifact({
        artifactId: artifact.id,
        contentMarkdown: "Cross matter edit.",
        matterId: otherMatter.id,
        step: documentEditorStep,
        workflowDefinitionId: "chronology",
        workflowRunId,
      }),
    ).rejects.toThrow("current matter");
  } finally {
    await cleanupMatter(matter.id);
    await prisma.matter.delete({
      where: {
        id: otherMatter.id,
      },
    });
  }
});
