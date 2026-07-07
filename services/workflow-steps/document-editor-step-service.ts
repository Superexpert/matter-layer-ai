import "server-only";

import { prisma } from "@/lib/prisma";
import { saveWorkflowMatterDocument } from "@/services/matter-documents/matter-document-service";
import { emitWorkflowActivityEvent } from "@/services/workflows/workflow-activity-service";
import {
  createWorkflowMarkdownArtifact,
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
  assertDocumentEditorStepOutput,
  normalizeDocumentEditorStepConfig,
  type DocumentEditorStepConfig,
  type DocumentEditorStepOutput,
} from "@/workflow-steps/document-editor/schema";
import { composeEminentDomainClientSummary } from "@/workflow-steps/extraction/profiles/eminent-domain/client-summary-document";
import { composeEminentDomainLawyerMemo } from "@/workflow-steps/extraction/profiles/eminent-domain/lawyer-memo-document";
import type { EminentDomainAssessmentItem } from "@/workflow-steps/extraction/profiles/eminent-domain/schema";

export type DocumentEditorStepState = {
  artifactId: string;
  completionButtonLabel: string;
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

function savedMatterDocumentIdFromOutput(output: unknown) {
  if (
    isObjectRecord(output) &&
    typeof output.savedMatterDocumentId === "string" &&
    output.savedMatterDocumentId.trim()
  ) {
    return output.savedMatterDocumentId.trim();
  }

  return null;
}

function completedDocumentEditorOutput(output: unknown) {
  if (!isObjectRecord(output) || output.status !== "completed") {
    return null;
  }

  return assertDocumentEditorStepOutput(output);
}

function generatedArtifactIdFromOutput(output: unknown, artifactOutputKey: string) {
  if (!isObjectRecord(output)) {
    return null;
  }

  const artifactId = output[artifactOutputKey];

  return typeof artifactId === "string" && artifactId.trim()
    ? artifactId.trim()
    : null;
}

function defaultDocumentFileName(title: string) {
  const safeTitle = title.replace(/[^a-zA-Z0-9._ -]/g, "_").trim();

  if (!safeTitle) {
    throw new Error("Document editor matter document title cannot be empty.");
  }

  return safeTitle.endsWith(".md") ? safeTitle : `${safeTitle}.md`;
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
  const currentOutput = await readWorkflowStepOutput({
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  const currentArtifactId = generatedArtifactIdFromOutput(
    currentOutput?.outputJson,
    config.artifactOutputKey,
  );

  if (currentArtifactId) {
    return currentArtifactId;
  }

  const previousOutput = await readWorkflowStepOutput({
    stepId: config.inputStepId,
    workflowRunId: input.workflowRunId,
  });

  if (!isObjectRecord(previousOutput?.outputJson)) {
    throw new Error(
      "This document cannot be generated until the previous workflow step is complete.",
    );
  }

  const artifactId = previousOutput.outputJson[config.artifactOutputKey];
  if (typeof artifactId !== "string" || !artifactId.trim()) {
    if (config.generatedArtifact) {
      return createConfiguredGeneratedArtifact({
        config,
        input,
      });
    }

    throw new Error(
      "The previous workflow step has not generated this document yet.",
    );
  }

  return artifactId.trim();
}

function eminentDomainAssessmentItemsFromOutput(
  extractionOutput: unknown,
  extractionOutputKey: string,
) {
  if (!isObjectRecord(extractionOutput)) {
    throw new Error("Extraction output was not found for this document.");
  }

  const keyedOutput = extractionOutput[extractionOutputKey];
  const profileOutput = isObjectRecord(keyedOutput)
    ? keyedOutput
    : isObjectRecord(extractionOutput.profileOutput)
      ? extractionOutput.profileOutput
      : null;
  const assessments = profileOutput?.assessments;

  if (!Array.isArray(assessments)) {
    throw new Error("Extraction output does not include eminent domain assessment data.");
  }

  return assessments.filter((item): item is EminentDomainAssessmentItem => {
    if (!isObjectRecord(item) || !isObjectRecord(item.assessment)) {
      return false;
    }

    return (
      typeof item.sourceDocumentId === "string" &&
      typeof item.sourceFileName === "string"
    );
  });
}

async function reviewedArtifactMarkdown(input: {
  matterId: string;
  reviewedStepId?: string;
  workflowRunId: string;
}) {
  if (!input.reviewedStepId) {
    return null;
  }

  const reviewedOutput = await readWorkflowStepOutput({
    stepId: input.reviewedStepId,
    workflowRunId: input.workflowRunId,
  });

  if (!isObjectRecord(reviewedOutput?.outputJson)) {
    return null;
  }

  const artifactId =
    typeof reviewedOutput.outputJson.reviewedArtifactId === "string"
      ? reviewedOutput.outputJson.reviewedArtifactId
      : typeof reviewedOutput.outputJson.sourceArtifactId === "string"
        ? reviewedOutput.outputJson.sourceArtifactId
        : null;

  if (!artifactId) {
    return null;
  }

  const artifact = await getWorkflowMarkdownArtifact({
    artifactId,
    matterId: input.matterId,
    workflowRunId: input.workflowRunId,
  });

  return artifact.currentRevision?.content ?? artifact.content ?? null;
}

async function createConfiguredGeneratedArtifact(input: {
  config: DocumentEditorStepConfig;
  input: BaseDocumentEditorInput;
}) {
  const generatedArtifact = input.config.generatedArtifact;

  if (!generatedArtifact) {
    throw new Error("Document editor generated artifact configuration was not found.");
  }

  const extractionOutput = await readWorkflowStepOutput({
    stepId: generatedArtifact.extractionStepId,
    workflowRunId: input.input.workflowRunId,
  });

  if (!isObjectRecord(extractionOutput?.outputJson)) {
    throw new Error(
      "This document cannot be generated until the extraction step is complete.",
    );
  }

  if (extractionOutput.outputJson.status !== "completed") {
    throw new Error(
      "This document cannot be generated until the extraction step is complete.",
    );
  }

  const assessmentItems = eminentDomainAssessmentItemsFromOutput(
    extractionOutput.outputJson,
    generatedArtifact.extractionOutputKey,
  );
  const reviewedLawyerMemoMarkdown = await reviewedArtifactMarkdown({
    matterId: input.input.matterId,
    reviewedStepId: generatedArtifact.reviewedLawyerMemoStepId,
    workflowRunId: input.input.workflowRunId,
  });

  if (
    generatedArtifact.kind === "eminent-domain-client-summary" &&
    !reviewedLawyerMemoMarkdown
  ) {
    throw new Error(
      "The client summary cannot be generated until the lawyer memo has been reviewed and saved.",
    );
  }

  const content = generatedArtifact.kind === "eminent-domain-lawyer-memo"
    ? composeEminentDomainLawyerMemo({
        items: assessmentItems,
      })
    : composeEminentDomainClientSummary({
        items: assessmentItems,
        reviewedLawyerMemoMarkdown,
      });
  const artifact = await createWorkflowMarkdownArtifact({
    content,
    matterId: input.input.matterId,
    metadataJson: {
      generatedFromAssessmentCount: assessmentItems.length,
      generatedFromReviewedLawyerMemo: Boolean(reviewedLawyerMemoMarkdown),
      generatedArtifactKind: generatedArtifact.kind,
      profile: "eminent-domain-case-assessment",
    },
    stepId: input.input.step.id,
    title: input.config.documentTitle ?? "Generated Work Product",
    workflowRunId: input.input.workflowRunId,
  });

  await writeWorkflowStepOutput({
    outputJson: {
      [input.config.artifactOutputKey]: artifact.id,
      status: "generated",
    },
    stepId: input.input.step.id,
    workflowRunId: input.input.workflowRunId,
  });

  return artifact.id;
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
    completionButtonLabel: config.completionButtonLabel ?? "Done",
    contentMarkdown,
    contentType: "MARKDOWN",
    editorContentHtml: markdownToEditorHtml(contentMarkdown),
    latestOutput: completedDocumentEditorOutput(latestOutput?.outputJson),
    saveMode: config.saveMode,
    title: artifact.title,
  };
}

export async function saveDocumentEditorArtifact(
  input: SaveDocumentEditorArtifactInput,
): Promise<DocumentEditorStepOutput> {
  const { artifact, config } = await loadConfiguredArtifact(input);
  const previousOutput = await readWorkflowStepOutput({
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  if (artifact.id !== input.artifactId) {
    throw new Error("Document editor artifact does not match the configured input artifact.");
  }

  if (!input.contentMarkdown.trim()) {
    throw new Error("Reviewed document content cannot be empty.");
  }

  if (!input.userId) {
    throw new Error("Saving a reviewed document to matter documents requires a user.");
  }

  const documentTitle = config.documentTitle ?? artifact.title;
  const documentFileName = config.documentFileName ?? defaultDocumentFileName(documentTitle);
  const savedMatterDocument = await saveWorkflowMatterDocument({
    contentMarkdown: input.contentMarkdown,
    editorJson: input.editorJson,
    existingMatterDocumentId: savedMatterDocumentIdFromOutput(previousOutput?.outputJson),
    fileName: documentFileName,
    matterId: input.matterId,
    stepId: input.step.id,
    title: documentTitle,
    userId: input.userId,
    workflowDefinitionId: input.workflowDefinitionId,
    workflowRunId: input.workflowRunId,
  });

  if (config.saveMode === "overwrite") {
    const output: DocumentEditorStepOutput = {
      artifactId: artifact.id,
      savedMatterDocumentId: savedMatterDocument.id,
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
    await emitWorkflowActivityEvent({
      code: "workflow_document_saved_to_matter",
      documentId: savedMatterDocument.id,
      documentName: savedMatterDocument.fileName,
      level: "success",
      message: `Saved ${documentTitle} to matter documents.`,
      metadata: {
        matterId: input.matterId,
        savedMatterDocumentId: savedMatterDocument.id,
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      },
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
    savedMatterDocumentId: savedMatterDocument.id,
    sourceArtifactId: artifact.id,
    status: "completed",
  };

  await writeWorkflowStepOutput({
    outputJson: output,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  await emitWorkflowActivityEvent({
    code: "workflow_document_saved_to_matter",
    documentId: savedMatterDocument.id,
    documentName: savedMatterDocument.fileName,
    level: "success",
    message: `Saved ${documentTitle} to matter documents.`,
    metadata: {
      matterId: input.matterId,
      revisionId: revision.id,
      savedMatterDocumentId: savedMatterDocument.id,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    },
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  return output;
}
