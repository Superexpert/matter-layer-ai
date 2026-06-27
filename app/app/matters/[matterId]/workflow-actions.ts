"use server";

import {
  createCustomWorkflow,
  deleteCustomWorkflow,
  duplicateWorkflow,
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
  await requireCurrentUser();

  return loadExtractionStepState(input);
}

export async function runExtractionStepAction(input: {
  executionMode?: "autorun" | "manual";
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  await requireCurrentUser();

  return runExtractionStep(input);
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
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  const currentUser = await requireCurrentUser();

  return saveDocumentEditorArtifact({
    ...input,
    userId: currentUser.id,
  });
}
