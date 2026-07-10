import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, expect, test } from "vitest";

import { runAnalyzeStep } from "../../workflow-steps/analyze/server";
import { eminentDomainCaseAssessmentDefinition } from "../../workflows";
import { syncBuiltInWorkflows } from "../../services/workflows/catalog-service";

const prisma = new PrismaClient();

afterAll(async () => prisma.$disconnect());

beforeEach(async () => {
  await prisma.workflowArtifact.deleteMany();
  await prisma.workflowRunStepOutput.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.aiProviderConfig.deleteMany();
  await syncBuiltInWorkflows();
  await prisma.aiProviderConfig.create({ data: { apiKey: "test-key", isActive: true, model: "gpt-5.5", provider: "openai" } });
});

async function fixture() {
  const matter = await prisma.matter.create({ data: { name: "Analyze Matter" } });
  const workflowRun = await prisma.workflowRun.create({ data: { id: `analyze-${Date.now()}`, matterId: matter.id, workflowDefinitionId: eminentDomainCaseAssessmentDefinition.id } });
  await prisma.workflowRunStepOutput.create({ data: {
    outputJson: {
      collapsedFacts: [{ conflicts: [], evidence: [{ documentId: "doc-1", documentName: "Petition.pdf", excerpt: "The City filed the petition.", pageEnd: 1, pageStart: 1 }], factType: "EVENT", fields: { eventDate: "2026-03-18", eventType: "petition-filed" }, id: "collapsed-1", identity: { matchedFields: ["eventType", "eventDate"], ruleIndex: 0, strategy: "multiKey" }, identityKey: "event", sourceFactIds: ["raw-1"], status: "resolved" }],
      profile: "eminent-domain-facts", rawFacts: [{ id: "raw-1" }], status: "completed",
    },
    stepId: "analyze-case-documents", workflowRunId: workflowRun.id,
  } });
  const step = eminentDomainCaseAssessmentDefinition.steps.find((candidate) => candidate.id === "analyze-case")!;
  return { matter, step, workflowRun };
}

test("Analyze runs generators in parallel, uses one packet, and persists Markdown artifacts", async () => {
  const { matter, step, workflowRun } = await fixture();
  const analyzeStep = { ...step, parameters: { ...step.parameters, model: "gpt-5.4-nano" } };
  const prompts: string[] = [];
  const models: Array<string | undefined> = [];
  let active = 0;
  let maxActive = 0;
  const output = await runAnalyzeStep({
    aiService: { generateText: async (request) => {
      prompts.push(request.messages[1]?.content ?? "");
      models.push(request.model);
      active += 1; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { content: "# Generated\n\nSupported statement.", model: "gpt-5.5", provider: "openai" };
    } },
    matterId: matter.id, step: analyzeStep, workflowDefinitionId: eminentDomainCaseAssessmentDefinition.id, workflowRunId: workflowRun.id,
  });
  expect(output.status).toBe("completed");
  expect(output.artifactIds).toHaveLength(2);
  expect(maxActive).toBe(2);
  expect(prompts).toHaveLength(2);
  expect(models).toEqual(["gpt-5.4-nano", "gpt-5.4-nano"]);
  expect(output.model).toBe("gpt-5.4-nano");
  const packets = prompts.map((prompt) => prompt.slice(prompt.indexOf('{"facts"')));
  expect(packets[0]).toBe(packets[1]);
  expect(prompts[0]).not.toContain("rawFacts");
  expect(await prisma.workflowArtifact.count({ where: { workflowRunId: workflowRun.id } })).toBe(2);
});

test("Analyze preserves success and retries only failed generators", async () => {
  const { matter, step, workflowRun } = await fixture();
  let calls = 0;
  const first = await runAnalyzeStep({
    aiService: { generateText: async () => {
      calls += 1;
      if (calls === 2) throw new Error("simulated client summary failure");
      return { content: "# Lawyer Memo", model: "gpt-5.5", provider: "openai" };
    } }, matterId: matter.id, step, workflowDefinitionId: eminentDomainCaseAssessmentDefinition.id, workflowRunId: workflowRun.id,
  });
  expect(first.status).toBe("partial_failed");
  expect(first.artifactIds).toHaveLength(1);
  const retryCalls: string[] = [];
  const retried = await runAnalyzeStep({
    aiService: { generateText: async (request) => { retryCalls.push(request.messages[1]?.content ?? ""); return { content: "# Client Summary", model: "gpt-5.5", provider: "openai" }; } },
    executionMode: "retry_failed", matterId: matter.id, step, workflowDefinitionId: eminentDomainCaseAssessmentDefinition.id, workflowRunId: workflowRun.id,
  });
  expect(retried.status).toBe("completed");
  expect(retryCalls).toHaveLength(1);
  expect(retryCalls[0]).toContain("Client Summary");
  expect(await prisma.workflowArtifact.count({ where: { workflowRunId: workflowRun.id } })).toBe(2);
});
