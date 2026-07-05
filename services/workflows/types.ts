export const WORKFLOW_STEP_TYPES = [
  "fileSelector",
  "form",
  "extraction",
  "ai",
  "documentEditor",
  "saveDocument",
  "workflowEditor",
  "workflowReview",
  "saveWorkflow",
  "runWorkflow",
  "decision",
] as const;

export type WorkflowStepType = (typeof WORKFLOW_STEP_TYPES)[number];

export type WorkflowBuilderStepId =
  | "define-goal"
  | "generate-draft"
  | "edit-workflow"
  | "save-workflow";

export type WorkflowBuilderStatus =
  | "definingGoal"
  | "generatingDraft"
  | "editingWorkflow"
  | "saving"
  | "saved";

export type WorkflowSchema = {
  description: string;
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type WorkflowStepDefinition = {
  id: string;
  type: string;
  name: string;
  description?: string;
  autorun?: boolean;
  parameters: Record<string, unknown>;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStepDefinition[];
};

export type WorkflowCatalogSource = "builtIn" | "custom";

export type WorkflowCatalogItem = WorkflowDefinition & {
  isBuiltIn: boolean;
  source: WorkflowCatalogSource;
};

export type BuiltInWorkflowDefinition = {
  slug: string;
  builtInVersion: number;
  isSystem: boolean;
  isEnabledByDefault: boolean;
  definition: WorkflowDefinition;
};

export type WorkflowBuilderState = {
  goal: string;
  draftWorkflowDefinition: WorkflowDefinition | null;
  approvedWorkflowDefinition: WorkflowDefinition | null;
  status: WorkflowBuilderStatus;
};

export type WorkflowRun = {
  id: string;
  workflowDefinitionId: string;
  status: "pending" | "running" | "completed" | "failed";
  stepRuns: WorkflowStepRun[];
};

export type WorkflowStepRun = {
  id: string;
  workflowRunId: string;
  stepDefinitionId: string;
  status: "pending" | "running" | "completed" | "failed";
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
};

export type WorkflowStepCanvasPlaceholder = {
  kind: "placeholder";
  label: string;
};

export type WorkflowStepAdminSettingOption = {
  label: string;
  value: string;
};

export type WorkflowStepAdminSettingDefinition = {
  key: string;
  label: string;
  description: string;
  defaultValue: unknown;
} & (
  | {
      type: "aiProvider";
    }
  | {
      type: "select";
      options: WorkflowStepAdminSettingOption[];
    }
  | {
      type: "text" | "textarea";
      placeholder?: string;
    }
);

export type WorkflowStepRegistration = {
  type: WorkflowStepType;
  displayName: string;
  description: string;
  adminSettings?: WorkflowStepAdminSettingDefinition[];
  parameterSchema: WorkflowSchema;
  inputSchema: WorkflowSchema;
  outputSchema: WorkflowSchema;
  CanvasComponent: WorkflowStepCanvasPlaceholder;
  execute: () => never;
  handleChatCommand?: () => never;
};

export type WorkflowDraftValidationResult = {
  valid: boolean;
  messages: string[];
};
