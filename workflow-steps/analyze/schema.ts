import type { WorkflowStepError } from "@/services/workflows/workflow-step-errors";

export type AnalyzeGeneratorConfig = {
  id: string;
  instructions: string;
  name: string;
  outputName: string;
};

export type AnalyzeStepConfig = {
  aggregate?: { outputName: string; renderer: "condemnor-appraisal-review" };
  aiProviderId?: string;
  generators: AnalyzeGeneratorConfig[];
  inputStepId: string;
  model?: string;
};

export type AnalyzeGeneratorResult = AnalyzeGeneratorConfig & {
  artifactId?: string;
  completedAt?: string;
  error?: WorkflowStepError;
  startedAt?: string;
  resultJson?: unknown;
  status: "queued" | "running" | "completed" | "failed";
};

export type AnalyzeStepOutput = {
  artifactIds: string[];
  completedAt?: string;
  generators: AnalyzeGeneratorResult[];
  inputStepId: string;
  model?: string;
  providerId?: string;
  startedAt?: string;
  status: "pending" | "running" | "completed" | "partial_failed" | "failed";
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Analyze step parameters must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Analyze step ${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function normalizeAnalyzeStepConfig(parameters: unknown): AnalyzeStepConfig {
  const parametersRecord = record(parameters);
  const raw = parametersRecord.config === undefined
    ? parametersRecord
    : record(parametersRecord.config);
  if (!Array.isArray(raw.generators) || raw.generators.length === 0) {
    throw new Error("Analyze step requires at least one generator.");
  }
  const generators = raw.generators.map((value, index) => {
    const generator = record(value);
    return {
      id: requiredString(generator.id, `generators[${index}].id`),
      instructions: requiredString(generator.instructions, `generators[${index}].instructions`),
      name: requiredString(generator.name, `generators[${index}].name`),
      outputName: requiredString(generator.outputName, `generators[${index}].outputName`),
    };
  });
  if (new Set(generators.map((generator) => generator.id)).size !== generators.length) {
    throw new Error("Analyze step generator IDs must be unique.");
  }
  return {
    aggregate: raw.aggregate === undefined ? undefined : (() => {
      const aggregate = record(raw.aggregate);
      const renderer = requiredString(aggregate.renderer, "aggregate.renderer");
      if (renderer !== "condemnor-appraisal-review") throw new Error(`Analyze aggregate renderer is not supported: ${renderer}`);
      return { outputName: requiredString(aggregate.outputName, "aggregate.outputName"), renderer };
    })(),
    aiProviderId: typeof raw.aiProviderId === "string" && raw.aiProviderId.trim()
      ? raw.aiProviderId.trim()
      : undefined,
    generators,
    inputStepId: requiredString(raw.inputStepId, "inputStepId"),
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined,
  };
}
