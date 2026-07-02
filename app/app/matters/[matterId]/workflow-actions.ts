"use server";

import { unstable_noStore as noStore } from "next/cache";

import {
  getEditableMatterDocument,
  listMatterDocuments,
  saveMatterDocumentEdits,
} from "@/services/matter-documents/matter-document-service";
import {
  createCustomWorkflow,
  deleteCustomWorkflow,
  duplicateWorkflow,
  getWorkflowCatalogItem,
} from "@/services/workflows/catalog-service";
import { requireCurrentUser } from "@/services/users/user-service";
import type { WorkflowDefinition } from "@/services/workflows/types";
import {
  loadExtractionStepState,
  runExtractionStep,
} from "@/workflow-steps/extraction/server";
import {
  loadDocumentEditorStepState,
  saveDocumentEditorArtifact,
} from "@/workflow-steps/document-editor/server";
import type { WorkflowStepDefinition } from "@/services/workflows/types";
import {
  loadFileSelectorStepState,
  saveFileSelectorStepSelection,
  uploadMatterDocuments,
} from "@/workflow-steps/file-selector/server";
import type { FileSelectorStepConfig } from "@/workflow-steps/file-selector/schema";

function workflowDebugLog(scope: "activity" | "autorun", message: string, metadata: Record<string, unknown> = {}) {
  if (process.env.WORKFLOW_DEBUG !== "true" && process.env.WORKFLOW_DEBUG !== "1") {
    return;
  }

  console.info(`[workflow:${scope}] ${message}`, metadata);
}

export async function saveCustomWorkflowAction(workflow: WorkflowDefinition) {
  const currentUser = await requireCurrentUser();

  return createCustomWorkflow(workflow, currentUser.id);
}

export async function duplicateWorkflowAction(workflowId: string) {
  const currentUser = await requireCurrentUser();

  return duplicateWorkflow(workflowId, currentUser.id);
}

export async function deleteWorkflowAction(workflowId: string) {
  await requireCurrentUser();
  await deleteCustomWorkflow(workflowId);
}

export async function listMatterDocumentsAction(input: {
  matterId: string;
}) {
  noStore();
  await requireCurrentUser();

  return listMatterDocuments(input);
}

export async function getEditableMatterDocumentAction(input: {
  matterDocumentId: string;
  matterId: string;
}) {
  noStore();
  await requireCurrentUser();

  return getEditableMatterDocument(input);
}

export async function saveMatterDocumentEditsAction(input: {
  contentMarkdown: string;
  editorJson?: unknown;
  matterDocumentId: string;
  matterId: string;
}) {
  noStore();
  await requireCurrentUser();

  return saveMatterDocumentEdits(input);
}

export async function loadFileSelectorStepStateAction(input: {
  matterId: string;
  stepId: string;
  workflowRunId: string;
}) {
  await requireCurrentUser();

  return loadFileSelectorStepState(input);
}

export async function uploadFileSelectorFilesAction(input: {
  config: FileSelectorStepConfig;
  formData: FormData;
  matterId: string;
}) {
  const currentUser = await requireCurrentUser();
  const files = input.formData
    .getAll("files")
    .filter((value): value is File => value instanceof File);

  return uploadMatterDocuments({
    config: input.config,
    files,
    matterId: input.matterId,
    userId: currentUser.id,
  });
}

export async function saveFileSelectorSelectionAction(input: {
  config: FileSelectorStepConfig;
  matterId: string;
  selectedMatterDocumentIds: string[];
  stepId: string;
  uploadedDuringStepMatterDocumentIds: string[];
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  const currentUser = await requireCurrentUser();

  return saveFileSelectorStepSelection({
    ...input,
    userId: currentUser.id,
  });
}

export async function loadExtractionStepStateAction(input: {
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  noStore();
  await requireCurrentUser();

  workflowDebugLog("activity", "Fetching activity", {
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  const state = await loadExtractionStepState(input);
  workflowDebugLog("activity", "Returned activity events", {
    eventCount: state.activityEvents.length,
    latestEvent: state.activityEvents.at(-1)?.code ?? null,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  return state;
}

export async function runExtractionStepAction(input: {
  executionMode?: "autorun" | "manual";
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  noStore();
  await requireCurrentUser();

  workflowDebugLog("autorun", "Server execution requested", {
    autorun: input.step.autorun === true,
    executionMode: input.executionMode ?? "manual",
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  try {
    const output = await runExtractionStep(input);
    workflowDebugLog("autorun", "Server execution returned", {
      status: output.status,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    return output;
  } catch (error) {
    console.error("[workflow:autorun] Server execution failed", {
      error,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
    throw error;
  }
}

export async function loadDocumentEditorStepStateAction(input: {
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  await requireCurrentUser();

  return loadDocumentEditorStepState(input);
}

export async function saveDocumentEditorArtifactAction(input: {
  artifactId: string;
  contentMarkdown: string;
  editorJson?: unknown;
  matterId: string;
  stepId: string;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  const currentUser = await requireCurrentUser();
  const workflow = await getWorkflowCatalogItem(input.workflowDefinitionId);
  const step = workflow.steps.find((candidateStep) => candidateStep.id === input.stepId);

  if (!step) {
    throw new Error(`Workflow step was not found: ${input.stepId}`);
  }

  return saveDocumentEditorArtifact({
    ...input,
    step,
    userId: currentUser.id,
  });
}
