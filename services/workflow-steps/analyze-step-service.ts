import "server-only";

import { prisma } from "@/lib/prisma";
import { createAIServiceFromSettings } from "@/services/ai/ai-service";
import type { AIRequest } from "@/services/ai/types";
import type { ConfiguredAISettings } from "@/services/ai/ai-settings-service";
import { getConfiguredAISettingsById } from "@/services/ai/ai-settings-service";
import { classifyAIProviderError } from "@/services/ai/provider-errors";
import { isRegisteredAIModel } from "@/services/ai/provider-registry";
import { verboseAnalyzeLog } from "@/services/diagnostics/verbose-logging";
import { createWorkflowMarkdownArtifact } from "@/services/workflows/workflow-artifact-service";
import { getWorkflowCatalogItem } from "@/services/workflows/catalog-service";
import { readWorkflowStepOutput, writeWorkflowStepOutput } from "@/services/workflows/workflow-step-output-service";
import { effectiveWorkflowStepProvider, resolveWorkflowStepAIProvider, type EffectiveWorkflowStepProvider } from "@/services/workflows/workflow-step-settings-service";
import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { compactCollapsedFacts } from "@/workflow-steps/analyze/compact-facts";
import { analyzeGeneratorMessages } from "@/workflow-steps/analyze/generators";
import { ANALYZE_WORK_PRODUCT_RESPONSE_FORMAT, normalizeGeneratedWorkProduct } from "@/workflow-steps/analyze/work-product-citations";
import { normalizeAnalyzeStepConfig, type AnalyzeGeneratorResult, type AnalyzeStepOutput } from "@/workflow-steps/analyze/schema";
import type { CollapsedFact } from "@/workflow-steps/extraction/collapsed-fact";

const ANALYZE_GENERATOR_CONCURRENCY = 3;

export type AnalyzeStepState = {
  effectiveAIProvider: EffectiveWorkflowStepProvider | null;
  latestOutput: AnalyzeStepOutput | null;
};

export type RunAnalyzeStepInput = {
  aiService?: { generateText: (request: AIRequest) => Promise<{ content: string; model: string; provider: string }> };
  executionMode?: "autorun" | "manual" | "retry_failed";
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
};

function objectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOutput(value: unknown): AnalyzeStepOutput | null {
  if (!objectRecord(value) || !Array.isArray(value.generators) || !Array.isArray(value.artifactIds)) return null;
  return value as AnalyzeStepOutput;
}

function collapsedFactsFromOutput(value: unknown): CollapsedFact[] {
  if (!objectRecord(value) || !Array.isArray(value.collapsedFacts)) {
    throw new Error("Analyze requires completed Extraction output containing collapsed facts.");
  }
  if (value.collapsedFacts.length === 0) {
    throw new Error("Analyze cannot run because no collapsed facts are available.");
  }
  return value.collapsedFacts as CollapsedFact[];
}

async function assertRunAndInput(input: RunAnalyzeStepInput) {
  const [run, workflow] = await Promise.all([
    prisma.workflowRun.findUnique({ select: { matterId: true, workflowDefinitionId: true }, where: { id: input.workflowRunId } }),
    getWorkflowCatalogItem(input.workflowDefinitionId),
  ]);
  if (!run || run.matterId !== input.matterId || run.workflowDefinitionId !== input.workflowDefinitionId) {
    throw new Error("Workflow run does not belong to the current matter.");
  }
  const analyzeIndex = workflow.steps.findIndex((step) => step.id === input.step.id);
  const config = normalizeAnalyzeStepConfig(input.step.parameters);
  const inputIndex = workflow.steps.findIndex((step) => step.id === config.inputStepId);
  if (inputIndex < 0) throw new Error(`Analyze input step was not found: ${config.inputStepId}`);
  if (inputIndex >= analyzeIndex) throw new Error("Analyze input step must precede Analyze.");
  if (workflow.steps[inputIndex]?.type !== "extraction") throw new Error("Analyze input step must be an Extraction step with collapsed facts.");
  const inputOutput = await readWorkflowStepOutput({ stepId: config.inputStepId, workflowRunId: input.workflowRunId });
  if (!objectRecord(inputOutput?.outputJson) || !["completed", "partial_failed"].includes(String(inputOutput.outputJson.status))) {
    throw new Error("Extraction has not completed enough to analyze its collapsed facts.");
  }
  return { config, inputOutput: inputOutput.outputJson };
}

function errorResult(error: unknown) {
  const classified = classifyAIProviderError(error, "analyze");
  return { code: classified.code, message: classified.message, userMessage: "Matter Layer could not generate this work product. Please retry." };
}

async function existingGeneratorArtifact(input: {
  generatorId: string;
  stepId: string;
  workflowRunId: string;
}) {
  const artifacts = await prisma.workflowArtifact.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, metadataJson: true },
    where: { stepId: input.stepId, workflowRunId: input.workflowRunId },
  });
  return artifacts.find((artifact) =>
    objectRecord(artifact.metadataJson) && artifact.metadataJson.generatorId === input.generatorId,
  ) ?? null;
}

async function mapBounded<T, R>(values: T[], mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += ANALYZE_GENERATOR_CONCURRENCY) {
    results.push(...await Promise.all(values.slice(index, index + ANALYZE_GENERATOR_CONCURRENCY).map(mapper)));
  }
  return results;
}

export async function runAnalyzeStep(input: RunAnalyzeStepInput): Promise<AnalyzeStepOutput> {
  const { config, inputOutput } = await assertRunAndInput(input);
  const previousRow = await readWorkflowStepOutput({ stepId: input.step.id, workflowRunId: input.workflowRunId });
  const previous = parseOutput(previousRow?.outputJson);
  if (previous?.status === "running" || (previous?.status === "completed" && input.executionMode !== "retry_failed")) return previous;

  const collapsedFacts = collapsedFactsFromOutput(inputOutput);
  const packet = compactCollapsedFacts({ collapsedFacts, profileId: String(inputOutput.profile ?? "unknown") });
  verboseAnalyzeLog("[analyze:service]", "compact packet built", { collapsedFactCount: packet.metadata.collapsedFactCount, stepId: input.step.id, workflowRunId: input.workflowRunId });

  const resolved = await resolveWorkflowStepAIProvider({ stepId: input.step.id, workflowId: input.workflowDefinitionId });
  const configuredProvider = resolved.source === "default" && config.aiProviderId
    ? await getConfiguredAISettingsById(config.aiProviderId)
    : null;
  if (resolved.source === "default" && config.aiProviderId && !configuredProvider) {
    throw new Error(`Analyze AI Provider was not found: ${config.aiProviderId}`);
  }
  const baseSettings = configuredProvider ?? resolved.settings;
  const settings: ConfiguredAISettings = config.model ? { ...baseSettings, model: config.model } : baseSettings;
  if (!isRegisteredAIModel(settings.provider, settings.model)) throw new Error(`Analyze model ${settings.model} is not valid for ${settings.provider}.`);
  const aiService = input.aiService ?? createAIServiceFromSettings(settings);
  const previousById = new Map((previous?.generators ?? []).map((generator) => [generator.id, generator]));
  const targets = config.generators.filter((generator) => previousById.get(generator.id)?.status !== "completed");
  const startedAt = previous?.startedAt ?? new Date().toISOString();
  const runningGenerators: AnalyzeGeneratorResult[] = config.generators.map((generator) => {
    const prior = previousById.get(generator.id);
    return prior?.status === "completed" ? prior : { ...generator, startedAt: new Date().toISOString(), status: "running" };
  });
  await writeWorkflowStepOutput({ outputJson: { artifactIds: previous?.artifactIds ?? [], generators: runningGenerators, inputStepId: config.inputStepId, model: settings.model, providerId: settings.provider, startedAt, status: "running" }, stepId: input.step.id, workflowRunId: input.workflowRunId });
  verboseAnalyzeLog("[analyze:service]", "run started", { generatorCount: targets.length, model: settings.model, provider: settings.provider, stepId: input.step.id, workflowRunId: input.workflowRunId });

  const generated = await mapBounded(targets, async (generator): Promise<AnalyzeGeneratorResult> => {
    verboseAnalyzeLog("[analyze:generator]", "generator started", { generatorId: generator.id, stepId: input.step.id, workflowRunId: input.workflowRunId });
    try {
      const existingArtifact = await existingGeneratorArtifact({ generatorId: generator.id, stepId: input.step.id, workflowRunId: input.workflowRunId });
      if (existingArtifact) {
        return { ...generator, artifactId: existingArtifact.id, completedAt: new Date().toISOString(), status: "completed" };
      }
      const response = await aiService.generateText({ maxOutputTokens: 8000, messages: analyzeGeneratorMessages({ generator, packet }), model: settings.model, responseFormat: ANALYZE_WORK_PRODUCT_RESPONSE_FORMAT });
      const content = normalizeGeneratedWorkProduct({ packet, responseContent: response.content });
      const artifact = await createWorkflowMarkdownArtifact({ content, matterId: input.matterId, metadataJson: { description: `Generated by Analyze: ${generator.name}`, generatorId: generator.id, model: response.model, provider: response.provider }, stepId: input.step.id, title: generator.outputName, workflowRunId: input.workflowRunId });
      verboseAnalyzeLog("[analyze:generator]", "generator completed", { artifactId: artifact.id, generatorId: generator.id, stepId: input.step.id, workflowRunId: input.workflowRunId });
      return { ...generator, artifactId: artifact.id, completedAt: new Date().toISOString(), status: "completed" };
    } catch (error) {
      console.error("[analyze:generator] generator failed", { error, generatorId: generator.id, stepId: input.step.id, workflowRunId: input.workflowRunId });
      return { ...generator, completedAt: new Date().toISOString(), error: errorResult(error), status: "failed" };
    }
  });
  const generatedById = new Map(generated.map((generator) => [generator.id, generator]));
  const generators = config.generators.map((generator) => generatedById.get(generator.id) ?? previousById.get(generator.id) ?? { ...generator, status: "queued" as const });
  const completed = generators.filter((generator) => generator.status === "completed");
  const failed = generators.filter((generator) => generator.status === "failed");
  const status = failed.length === 0 ? "completed" : completed.length ? "partial_failed" : "failed";
  const output: AnalyzeStepOutput = { artifactIds: completed.flatMap((generator) => generator.artifactId ? [generator.artifactId] : []), completedAt: new Date().toISOString(), generators, inputStepId: config.inputStepId, model: settings.model, providerId: settings.provider, startedAt, status };
  await writeWorkflowStepOutput({ outputJson: output, stepId: input.step.id, workflowRunId: input.workflowRunId });
  verboseAnalyzeLog("[analyze:service]", "run completed", { completedGeneratorCount: completed.length, failedGeneratorCount: failed.length, status, stepId: input.step.id, workflowRunId: input.workflowRunId });
  return output;
}

export async function loadAnalyzeStepState(input: Omit<RunAnalyzeStepInput, "aiService" | "executionMode">): Promise<AnalyzeStepState> {
  const output = await readWorkflowStepOutput({ stepId: input.step.id, workflowRunId: input.workflowRunId });
  return { effectiveAIProvider: await effectiveWorkflowStepProvider({ stepId: input.step.id, workflowId: input.workflowDefinitionId }), latestOutput: parseOutput(output?.outputJson) };
}
