import {
  WORKFLOW_STEP_TYPES,
  type WorkflowSchema,
  type WorkflowStepRegistration,
  type WorkflowStepType,
} from "./types";
import { extractionStep } from "@/workflow-steps/extraction/definition";
import { fileSelectorStep } from "@/workflow-steps/file-selector/definition";
import { documentEditorStep } from "@/workflow-steps/document-editor/definition";
import { reviewWorkProductsStep } from "@/workflow-steps/review-work-products/definition";

function placeholderExecute(): never {
  throw new Error("Workflow execution is not implemented yet.");
}

function placeholderHandleChatCommand(): never {
  throw new Error("Workflow chat commands are not implemented for this step yet.");
}

const emptyObjectSchema: WorkflowSchema = {
  additionalProperties: true,
  description: "No parameters are required for this first iteration.",
  type: "object",
};

const aiParameterSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "AI prompt and output mode configuration.",
  properties: {
    outputMode: {
      enum: ["text", "json", "workflowDefinitionDraft", "documentDraft"],
      type: "string",
    },
    systemPrompt: {
      type: "string",
    },
  },
  required: ["systemPrompt", "outputMode"],
  type: "object",
};

// TODO: Move the remaining standard step registrations into /workflow-steps
// after their runtime implementations exist.
function register(
  type: WorkflowStepType,
  displayName: string,
  description: string,
  parameterSchema: WorkflowSchema = emptyObjectSchema,
): WorkflowStepRegistration {
  return {
    CanvasComponent: {
      kind: "placeholder",
      label: `${displayName} canvas`,
    },
    description,
    displayName,
    execute: placeholderExecute,
    handleChatCommand: placeholderHandleChatCommand,
    inputSchema: emptyObjectSchema,
    outputSchema: emptyObjectSchema,
    parameterSchema,
    type,
  };
}

export const workflowStepRegistry: Record<WorkflowStepType, WorkflowStepRegistration> = {
  ai: register(
    "ai",
    "AI",
    "Use AI to generate text, JSON, workflow drafts, or document drafts.",
    aiParameterSchema,
  ),
  decision: register(
    "decision",
    "Decision",
    "Branch workflow behavior based on structured conditions.",
  ),
  documentEditor: documentEditorStep,
  extraction: extractionStep,
  fileSelector: fileSelectorStep,
  form: register(
    "form",
    "Form",
    "Collect structured information from the user.",
  ),
  runWorkflow: register(
    "runWorkflow",
    "Run Workflow",
    "Run another workflow as a nested step.",
  ),
  reviewWorkProducts: reviewWorkProductsStep,
  saveDocument: register(
    "saveDocument",
    "Save Document",
    "Save a generated or edited document to the matter.",
  ),
  saveWorkflow: register(
    "saveWorkflow",
    "Save Workflow",
    "Save an approved workflow definition.",
  ),
  workflowEditor: register(
    "workflowEditor",
    "Workflow Editor",
    "Visually edit a workflow definition.",
  ),
  workflowReview: register(
    "workflowReview",
    "Workflow Review",
    "Review, revise, approve, or save a draft workflow definition.",
  ),
};

export function getWorkflowStepRegistration(type: WorkflowStepType) {
  return workflowStepRegistry[type];
}

export function isWorkflowStepType(value: string): value is WorkflowStepType {
  return (WORKFLOW_STEP_TYPES as readonly string[]).includes(value);
}

export function registeredWorkflowStepTypes() {
  return WORKFLOW_STEP_TYPES.map((type) => workflowStepRegistry[type]);
}
