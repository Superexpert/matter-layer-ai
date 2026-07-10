import type { WorkflowSchema, WorkflowStepRegistration } from "@/services/workflows/types";

export const analyzeParameterSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Serializable Analyze configuration suitable for future Markdown workflow authoring.",
  properties: {
    aiProviderId: { type: ["string", "null"] },
    generators: { items: { type: "object" }, type: "array" },
    inputStepId: { type: "string" },
    model: { type: ["string", "null"] },
  },
  required: ["inputStepId", "generators"],
  type: "object",
};

const emptySchema: WorkflowSchema = { additionalProperties: true, description: "Analyze runtime input.", type: "object" };

export const analyzeStep: WorkflowStepRegistration = {
  adminSettings: [{ defaultValue: null, description: "Use a specific AI Provider for Analyze, or use the app default.", key: "aiProviderId", label: "AI Provider", type: "aiProvider" }],
  CanvasComponent: { kind: "placeholder", label: "Analyze canvas" },
  description: "Analyze collapsed facts and generate Markdown work products.",
  displayName: "Analyze",
  execute: () => { throw new Error("Analyze execution is handled by the interactive step."); },
  inputSchema: emptySchema,
  outputSchema: emptySchema,
  parameterSchema: analyzeParameterSchema,
  type: "analyze",
};
