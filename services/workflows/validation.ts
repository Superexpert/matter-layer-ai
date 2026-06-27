import { isWorkflowStepType } from "./registry";
import type {
  WorkflowBuilderState,
  WorkflowDefinition,
  WorkflowDraftValidationResult,
  WorkflowStepDefinition,
} from "./types";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isWorkflowStepDefinition(
  value: unknown,
): value is WorkflowStepDefinition {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.name === "string" &&
    isObjectRecord(value.parameters) &&
    (value.autorun === undefined || typeof value.autorun === "boolean") &&
    (value.description === undefined || typeof value.description === "string")
  );
}

export function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.steps) &&
    value.steps.every(isWorkflowStepDefinition)
  );
}

export function isWorkflowBuilderState(value: unknown): value is WorkflowBuilderState {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.goal === "string" &&
    (value.draftWorkflowDefinition === null ||
      isWorkflowDefinition(value.draftWorkflowDefinition)) &&
    (value.approvedWorkflowDefinition === null ||
      isWorkflowDefinition(value.approvedWorkflowDefinition)) &&
    (value.status === "definingGoal" ||
      value.status === "generatingDraft" ||
      value.status === "editingWorkflow" ||
      value.status === "saving" ||
      value.status === "saved")
  );
}

export function validateWorkflowDefinitionDraft(
  workflow: WorkflowDefinition | null,
): WorkflowDraftValidationResult {
  const messages: string[] = [];

  if (!workflow) {
    return {
      messages: ["Workflow draft has not been started."],
      valid: false,
    };
  }

  if (!workflow.name.trim()) {
    messages.push("Workflow must have a name.");
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    messages.push("Workflow must have at least one step.");
  }

  workflow.steps.forEach((step, index) => {
    const stepLabel = `Step ${index + 1}`;

    if (!step.id.trim()) {
      messages.push(`${stepLabel} must have an id.`);
    }

    if (!step.type.trim()) {
      messages.push(`${stepLabel} must have a type.`);
    }

    if (!isWorkflowStepType(step.type)) {
      messages.push(`${stepLabel} uses an unregistered step type.`);
    }

    if (!step.name.trim()) {
      messages.push(`${stepLabel} must have a name.`);
    }

    if (!isObjectRecord(step.parameters)) {
      messages.push(`${stepLabel} parameters must be an object.`);
    }
  });

  return {
    messages,
    valid: messages.length === 0,
  };
}
