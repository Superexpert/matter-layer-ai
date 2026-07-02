import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  MatterDocumentSourceType,
  PrismaClient,
  WorkflowArtifactType,
} from "@prisma/client";
import { afterAll, expect, test } from "vitest";

import {
  getEditableMatterDocument,
  listMatterDocuments,
  saveMatterDocumentEdits,
} from "../../services/matter-documents/matter-document-service";
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
    documentFileName: "Chronology.md",
    documentTitle: "Chronology",
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

    await expect(listMatterDocuments({ matterId: matter.id })).resolves.toEqual([]);

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
      savedMatterDocumentId: expect.any(String),
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
    const savedMatterDocument = await prisma.matterDocument.findUniqueOrThrow({
      include: {
        content: true,
        representations: true,
      },
      where: {
        id: output.savedMatterDocumentId,
      },
    });
    const listedDocuments = await listMatterDocuments({
      matterId: matter.id,
    });
    const activityEvent = await prisma.workflowRunStepActivity.findFirstOrThrow({
      where: {
        code: "workflow_document_saved_to_matter",
        documentId: output.savedMatterDocumentId,
        stepId: documentEditorStep.id,
        workflowRunId,
      },
    });

    expect(updatedArtifact.content).toBe("# Chronology\n\nOriginal chronology.");
    expect(updatedArtifact.currentRevisionId).toBe(revision.id);
    expect(revision.content).toBe("# Chronology\n\nReviewed chronology.");
    expect(savedMatterDocument).toMatchObject({
      fileName: "Chronology.md",
      matterId: matter.id,
      mimeType: "text/markdown",
      sourceType: MatterDocumentSourceType.upload,
      uploadedByUserId: user.id,
    });
    expect(Buffer.from(savedMatterDocument.content?.bytes ?? []).toString("utf8")).toBe(
      "# Chronology\n\nReviewed chronology.",
    );
    expect(savedMatterDocument.representations).toHaveLength(1);
    expect(savedMatterDocument.representations[0]).toMatchObject({
      content: "# Chronology\n\nReviewed chronology.",
      status: MatterDocumentRepresentationStatus.READY,
      type: MatterDocumentRepresentationType.MARKDOWN,
    });
    expect(listedDocuments).toHaveLength(1);
    expect(listedDocuments[0]).toMatchObject({
      documentSection: "workProduct",
      fileName: "Chronology.md",
      id: output.savedMatterDocumentId,
      sourceType: "upload",
    });
    expect(activityEvent.metadataJson).toMatchObject({
      matterId: matter.id,
      savedMatterDocumentId: output.savedMatterDocumentId,
      workflowRunId,
    });
    expect(stepOutput.outputJson).toMatchObject({
      revisionId: revision.id,
      savedMatterDocumentId: output.savedMatterDocumentId,
      sourceArtifactId: artifact.id,
      status: "completed",
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("matter document listing classifies workflow metadata as work product", async () => {
  const { matter, user, workflowRunId } = await createFixture();

  try {
    const uploadedPdf = await prisma.matterDocument.create({
      data: {
        fileName: "source-evidence.pdf",
        matterId: matter.id,
        mimeType: "application/pdf",
        size: 4096,
        sourceType: MatterDocumentSourceType.upload,
        storageProvider: "database",
        uploadedByUserId: user.id,
      },
    });
    const legacyWorkflowDocument = await prisma.matterDocument.create({
      data: {
        fileName: "lawyer-notes.md",
        matterId: matter.id,
        mimeType: "text/markdown",
        representations: {
          create: {
            content: "# Lawyer notes",
            metadataJson: {
              source: "workflow_output",
              stepId: documentEditorStep.id,
              workflowDefinitionId: "chronology",
              workflowRunId,
            },
            status: MatterDocumentRepresentationStatus.READY,
            type: MatterDocumentRepresentationType.MARKDOWN,
          },
        },
        size: 14,
        sourceType: MatterDocumentSourceType.upload,
        storageProvider: "database",
        uploadedByUserId: user.id,
      },
    });
    const documents = await listMatterDocuments({
      matterId: matter.id,
    });
    const documentsById = new Map(
      documents.map((document) => [document.id, document]),
    );

    expect(documentsById.get(uploadedPdf.id)).toMatchObject({
      documentSection: "sourceDocument",
      fileName: "source-evidence.pdf",
      sourceType: "upload",
    });
    expect(documentsById.get(legacyWorkflowDocument.id)).toMatchObject({
      documentSection: "workProduct",
      fileName: "lawyer-notes.md",
      sourceType: "upload",
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("editing an existing work product document updates the same matter document", async () => {
  const { matter, user, workflowRunId } = await createFixture();

  try {
    const workProductDocument = await prisma.matterDocument.create({
      data: {
        fileName: "research-note.md",
        matterId: matter.id,
        mimeType: "text/markdown",
        representations: {
          create: {
            content: "# Research note\n\nInitial work product.",
            metadataJson: {
              source: "workflow_output",
              stepId: documentEditorStep.id,
              workflowDefinitionId: "chronology",
              workflowRunId,
            },
            status: MatterDocumentRepresentationStatus.READY,
            type: MatterDocumentRepresentationType.MARKDOWN,
          },
        },
        size: 38,
        sourceType: MatterDocumentSourceType.upload,
        storageProvider: "database",
        uploadedByUserId: user.id,
      },
    });
    const loadedDocument = await getEditableMatterDocument({
      matterDocumentId: workProductDocument.id,
      matterId: matter.id,
    });
    const updatedDocument = await saveMatterDocumentEdits({
      contentMarkdown: "# Research note\n\nUpdated work product.",
      editorJson: {
        type: "doc",
      },
      matterDocumentId: workProductDocument.id,
      matterId: matter.id,
    });
    const documents = await prisma.matterDocument.findMany({
      include: {
        representations: true,
      },
      where: {
        matterId: matter.id,
      },
    });

    expect(loadedDocument).toMatchObject({
      contentMarkdown: "# Research note\n\nInitial work product.",
      documentSection: "workProduct",
      fileName: "research-note.md",
      id: workProductDocument.id,
    });
    expect(loadedDocument.editorContentHtml).toContain("<h1>Research note</h1>");
    expect(updatedDocument).toMatchObject({
      contentMarkdown: "# Research note\n\nUpdated work product.",
      documentSection: "workProduct",
      fileName: "research-note.md",
      id: workProductDocument.id,
    });
    expect(documents).toHaveLength(1);
    expect(documents[0].representations[0]).toMatchObject({
      content: "# Research note\n\nUpdated work product.",
      status: MatterDocumentRepresentationStatus.READY,
      type: MatterDocumentRepresentationType.MARKDOWN,
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("source documents cannot be opened in the work product editor", async () => {
  const { matter, user } = await createFixture();

  try {
    const sourceDocument = await prisma.matterDocument.create({
      data: {
        fileName: "source.pdf",
        matterId: matter.id,
        mimeType: "application/pdf",
        size: 4096,
        sourceType: MatterDocumentSourceType.upload,
        storageProvider: "database",
        uploadedByUserId: user.id,
      },
    });

    await expect(
      getEditableMatterDocument({
        matterDocumentId: sourceDocument.id,
        matterId: matter.id,
      }),
    ).rejects.toThrow("Source documents are view-only.");
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("document editor updates the saved matter document on later saves", async () => {
  const { artifact, matter, user, workflowRunId } = await createFixture();

  try {
    const firstOutput = await saveDocumentEditorArtifact({
      artifactId: artifact.id,
      contentMarkdown: "# Chronology\n\nFirst saved chronology.",
      editorJson: {
        type: "doc",
      },
      matterId: matter.id,
      step: documentEditorStep,
      userId: user.id,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });
    const secondOutput = await saveDocumentEditorArtifact({
      artifactId: artifact.id,
      contentMarkdown: "# Chronology\n\nSecond saved chronology.",
      editorJson: {
        type: "doc",
      },
      matterId: matter.id,
      step: documentEditorStep,
      userId: user.id,
      workflowDefinitionId: "chronology",
      workflowRunId,
    });
    const documents = await prisma.matterDocument.findMany({
      include: {
        content: true,
        representations: true,
      },
      where: {
        matterId: matter.id,
      },
    });
    const revisions = await prisma.workflowArtifactRevision.findMany({
      where: {
        artifactId: artifact.id,
      },
    });

    expect(secondOutput.savedMatterDocumentId).toBe(firstOutput.savedMatterDocumentId);
    expect(documents).toHaveLength(1);
    expect(Buffer.from(documents[0].content?.bytes ?? []).toString("utf8")).toBe(
      "# Chronology\n\nSecond saved chronology.",
    );
    expect(documents[0].representations[0]).toMatchObject({
      content: "# Chronology\n\nSecond saved chronology.",
      status: MatterDocumentRepresentationStatus.READY,
      type: MatterDocumentRepresentationType.MARKDOWN,
    });
    expect(revisions).toHaveLength(2);
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
