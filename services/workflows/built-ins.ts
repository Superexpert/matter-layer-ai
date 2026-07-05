import { builtInWorkflows } from "@/workflows";

export { workflowBuilderDefinition } from "@/workflows";

export const builtInWorkflowDefinitions = builtInWorkflows.map(
  (workflow) => workflow.definition,
);
