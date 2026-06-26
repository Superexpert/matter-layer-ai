import type {
  BuiltInWorkflowDefinition,
  WorkflowDefinition,
} from "@/services/workflows/types";

export const WORKFLOW_BUILDER_SYSTEM_PROMPT = [
  "You are generating an initial Matter Layer workflow draft from a lawyer's business goal.",
  "",
  "Core behavior:",
  "- Treat the lawyer's goal as a business outcome.",
  "- Infer workflow steps from the desired outcome.",
  "- Use only registered workflow step types.",
  "- Never ask the lawyer to list workflow steps.",
  '- Never ask: "What steps do you want the workflow to include?"',
  "- Prefer a reasonable complete draft over broad questions.",
  "",
  "Registered step catalog:",
  "- fileSelector: lets the user select matter files",
  "- form: asks structured questions",
  "- extraction: extracts structured facts or events from selected matter documents",
  "- ai: generates, transforms, classifies, or reasons over information",
  "- documentEditor: displays an editable document",
  "- saveDocument: saves a document to the matter",
  "- runWorkflow: starts another workflow",
  "- decision: routes based on conditions",
  "",
  "Default workflow patterns to adapt:",
  "- Chronology: fileSelector, extraction, ai, documentEditor, saveDocument",
  "- Client matter update: fileSelector, extraction, ai, documentEditor, saveDocument",
  "- Form-driven document generation: form, ai, documentEditor, saveDocument",
  "- Routing workflow: form, decision, runWorkflow",
  "",
  "Expected output:",
  "- Return one complete draft WorkflowDefinition.",
  "- Include a name, description, and ordered steps.",
  "- Each step must include id, type, name, description, and parameters.",
].join("\n");

export const workflowBuilderDefinition: WorkflowDefinition = {
  description: "Create a new workflow from a goal, AI draft, visual editing, and save.",
  id: "workflow-builder",
  name: "Workflow Builder",
  steps: [
    {
      description: "Collect the business outcome the lawyer wants the workflow to accomplish.",
      id: "define-goal",
      name: "Define Goal",
      parameters: {
        purpose: "Collect the business outcome the lawyer wants the workflow to accomplish.",
      },
      type: "form",
    },
    {
      description: "Infer a draft WorkflowDefinition from the goal using only registered step types.",
      id: "generate-draft",
      name: "Generate Draft Workflow",
      parameters: {
        outputMode: "workflowDefinitionDraft",
        purpose: "Infer a draft WorkflowDefinition from the goal using only registered step types.",
        systemPrompt: WORKFLOW_BUILDER_SYSTEM_PROMPT,
      },
      type: "ai",
    },
    {
      description: "Visually edit the draft WorkflowDefinition.",
      id: "edit-workflow",
      name: "Edit Workflow",
      parameters: {
        purpose: "Visually edit the draft WorkflowDefinition.",
      },
      type: "workflowEditor",
    },
    {
      description: "Save the approved WorkflowDefinition to the available workflow catalog.",
      id: "save-workflow",
      name: "Save Workflow",
      parameters: {
        purpose: "Persist the approved WorkflowDefinition.",
      },
      type: "saveWorkflow",
    },
  ],
};

export const workflowBuilderBuiltIn: BuiltInWorkflowDefinition = {
  builtInVersion: 1,
  definition: workflowBuilderDefinition,
  isEnabledByDefault: true,
  isSystem: true,
  slug: "workflow-builder",
};
