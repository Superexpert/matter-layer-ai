import "server-only";

import { prisma } from "@/lib/prisma";
import {
  createWorkflowArtifactRevision,
  getWorkflowMarkdownArtifact,
  overwriteWorkflowArtifact,
} from "@/services/workflows/workflow-artifact-service";
import {
  readWorkflowStepOutput,
  writeWorkflowStepOutput,
} from "@/services/workflows/workflow-step-output-service";
import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { markdownToEditorHtml } from "@/workflow-steps/document-editor/conversion";
import {
  normalizeDocumentEditorStepConfig,
  type DocumentEditorStepOutput,
} from "@/workflow-steps/document-editor/schema";

export type DocumentEditorStepState = {
  artifactId: string;
  contentMarkdown: string;
  contentType: "MARKDOWN";
  editorContentHtml: string;
  latestOutput: DocumentEditorStepOutput | null;
  saveMode: "revision" | "overwrite";
  title: string;
};

type BaseDocumentEditorInput = {
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
};

type SaveDocumentEditorArtifactInput = BaseDocumentEditorInput & {
  artifactId: string;
  contentMarkdown: string;
  editorJson?: unknown;
  userId?: string | null;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function assertWorkflowRun(input: {
  matterId: string;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  const workflowRun = await prisma.workflowRun.findUnique({
    select: {
      id: true,
      matterId: true,
      workflowDefinitionId: true,
    },
    where: {
      id: input.workflowRunId,
    },
  });

  if (!workflowRun) {
    throw new Error("Workflow run was not found.");
  }

  if (
    workflowRun.matterId !== input.matterId ||
    workflowRun.workflowDefinitionId !== input.workflowDefinitionId
  ) {
    throw new Error("Workflow run does not belong to the current matter.");
  }

  return workflowRun;
}

async function inputStepArtifactId(input: BaseDocumentEditorInput) {
  const config = normalizeDocumentEditorStepConfig(input.step.parameters);
  const previousOutput = await readWorkflowStepOutput({
    stepId: config.inputStepId,
    workflowRunId: input.workflowRunId,
  });

  if (!isObjectRecord(previousOutput?.outputJson)) {
    throw new Error(`Document editor input step output was not found: ${config.inputStepId}`);
  }

  const artifactId = previousOutput.outputJson[config.artifactOutputKey];
  if (typeof artifactId !== "string" || !artifactId.trim()) {
    throw new Error(
      `Document editor input step output does not include ${config.artifactOutputKey}.`,
    );
  }

  return artifactId.trim();
}

async function loadConfiguredArtifact(input: BaseDocumentEditorInput) {
  const config = normalizeDocumentEditorStepConfig(input.step.parameters);

  if (config.contentType !== "MARKDOWN") {
    throw new Error(`Unsupported document editor content type: ${config.contentType}`);
  }

  if (config.editor !== "tiptap") {
    throw new Error(`Unsupported document editor: ${config.editor}`);
  }

  await assertWorkflowRun(input);
  const artifactId = await inputStepArtifactId(input);
  const artifact = await getWorkflowMarkdownArtifact({
    artifactId,
    matterId: input.matterId,
    workflowRunId: input.workflowRunId,
  });

  return {
    artifact,
    config,
  };
}

export async function loadDocumentEditorStepState(
  input: BaseDocumentEditorInput,
): Promise<DocumentEditorStepState> {
  const { artifact, config } = await loadConfiguredArtifact(input);
  const latestOutput = await readWorkflowStepOutput({
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  const contentMarkdown = artifact.currentRevision?.content ?? artifact.content ?? "";

  return {
    artifactId: artifact.id,
    contentMarkdown,
    contentType: "MARKDOWN",
    editorContentHtml: markdownToEditorHtml(contentMarkdown),
    latestOutput: isObjectRecord(latestOutput?.outputJson)
      ? (latestOutput.outputJson as DocumentEditorStepOutput)
      : null,
    saveMode: config.saveMode,
    title: artifact.title,
  };
}

export async function saveDocumentEditorArtifact(
  input: SaveDocumentEditorArtifactInput,
): Promise<DocumentEditorStepOutput> {
  const { artifact, config } = await loadConfiguredArtifact(input);

  if (artifact.id !== input.artifactId) {
    throw new Error("Document editor artifact does not match the configured input artifact.");
  }

  if (!input.contentMarkdown.trim()) {
    throw new Error("Reviewed document content cannot be empty.");
  }

  if (config.saveMode === "overwrite") {
    const output: DocumentEditorStepOutput = {
      artifactId: artifact.id,
      status: "completed",
    };

    await overwriteWorkflowArtifact({
      artifactId: artifact.id,
      content: input.contentMarkdown,
      userId: input.userId,
    });
    await writeWorkflowStepOutput({
      outputJson: output,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    return output;
  }

  const revision = await createWorkflowArtifactRevision({
    artifactId: artifact.id,
    content: input.contentMarkdown,
    editorJson: input.editorJson,
    matterId: input.matterId,
    stepId: input.step.id,
    userId: input.userId,
    workflowRunId: input.workflowRunId,
  });
  const output: DocumentEditorStepOutput = {
    reviewedArtifactId: artifact.id,
    revisionId: revision.id,
    sourceArtifactId: artifact.id,
    status: "completed",
  };

  await writeWorkflowStepOutput({
    outputJson: output,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  return output;
}
