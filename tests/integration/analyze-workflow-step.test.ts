import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, expect, test } from "vitest";

import { runAnalyzeStep } from "../../workflow-steps/analyze/server";
import { eminentDomainCaseAssessmentDefinition } from "../../workflows";
import { syncBuiltInWorkflows } from "../../services/workflows/catalog-service";
import { getEditableWorkflowArtifact, saveWorkflowArtifactEdits } from "../../services/workflows/workflow-run-service";

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
      collapsedFacts: [{ conflicts: [], evidence: [
        { documentId: "doc-1", documentName: "Initial Filing.pdf", excerpt: "The agency filed the initial pleading.", pageEnd: 1, pageStart: 1 },
        { documentId: "doc-2", documentName: "Scheduling Notice.pdf", excerpt: "The tribunal scheduled a hearing.", pageEnd: 3, pageStart: 3 },
      ], factType: "EVENT", fields: { eventDate: "2026-03-18", eventType: "petition-filed" }, id: "collapsed-1", identity: { matchedFields: ["eventType", "eventDate"], ruleIndex: 0, strategy: "multiKey" }, identityKey: "event", sourceFactIds: ["raw-1"], status: "resolved" }],
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
      return { content: JSON.stringify({ markdown: `# ${request.messages[1]?.content.includes("Lawyer Memo") ? "Lawyer Memo" : "Client Summary"}\n\nSupported statement {{ml-citation:citation-1}} {{ml-citation:citation-2}}.` }), model: "gpt-5.5", provider: "openai" };
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
  const artifacts = await prisma.workflowArtifact.findMany({ select: { content: true }, where: { workflowRunId: workflowRun.id } });
  expect(artifacts.every((artifact) => artifact.content?.match(/data-ml-citation="true"/g)?.length === 2)).toBe(true);
  expect(artifacts.every((artifact) => artifact.content?.includes('data-citation-source-document-id="doc-1"'))).toBe(true);
  expect(artifacts.every((artifact) => artifact.content?.includes('data-citation-source-document-id="doc-2"'))).toBe(true);
  expect(artifacts.every((artifact) => !artifact.content?.includes(">Initial Filing.pdf</span>"))).toBe(true);
  const lawyerMemoArtifactId = output.generators.find((generator) => generator.id === "lawyer-memo")?.artifactId;
  expect(lawyerMemoArtifactId).toBeTruthy();
  const lawyerMemo = await getEditableWorkflowArtifact({ artifactId: lawyerMemoArtifactId!, matterId: matter.id, workflowRunId: workflowRun.id });
  expect(lawyerMemo.editorContentHtml.match(/data-ml-citation="true"/g)).toHaveLength(2);
  await saveWorkflowArtifactEdits({ artifactId: lawyerMemoArtifactId!, contentMarkdown: lawyerMemo.contentMarkdown, matterId: matter.id, workflowRunId: workflowRun.id });
  const reloadedLawyerMemo = await getEditableWorkflowArtifact({ artifactId: lawyerMemoArtifactId!, matterId: matter.id, workflowRunId: workflowRun.id });
  expect(reloadedLawyerMemo.editorContentHtml.match(/data-ml-citation="true"/g)).toHaveLength(2);
});

test("Analyze preserves success and retries only failed generators", async () => {
  const { matter, step, workflowRun } = await fixture();
  const first = await runAnalyzeStep({
    aiService: { generateText: async (request) => {
      if (request.messages[1]?.content.includes("Work product: Client Summary")) {
        throw new Error("simulated client summary failure");
      }
      return { content: JSON.stringify({ markdown: "# Lawyer Memo" }), model: "gpt-5.5", provider: "openai" };
    } }, matterId: matter.id, step, workflowDefinitionId: eminentDomainCaseAssessmentDefinition.id, workflowRunId: workflowRun.id,
  });
  expect(first.status).toBe("partial_failed");
  expect(first.artifactIds).toHaveLength(1);
  const retryCalls: string[] = [];
  const retried = await runAnalyzeStep({
    aiService: { generateText: async (request) => { retryCalls.push(request.messages[1]?.content ?? ""); return { content: JSON.stringify({ markdown: "# Client Summary" }), model: "gpt-5.5", provider: "openai" }; } },
    executionMode: "retry_failed", matterId: matter.id, step, workflowDefinitionId: eminentDomainCaseAssessmentDefinition.id, workflowRunId: workflowRun.id,
  });
  expect(retried.status).toBe("completed");
  expect(retryCalls).toHaveLength(1);
  expect(retryCalls[0]).toContain("Client Summary");
  expect(await prisma.workflowArtifact.count({ where: { workflowRunId: workflowRun.id } })).toBe(2);
});

test.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])(
  "Analyze runs parallel generators with %s and does not fall back",
  async (model) => {
    const { matter, step, workflowRun } = await fixture();
    const requestedModels: Array<string | undefined> = [];
    const output = await runAnalyzeStep({
      aiService: { generateText: async (request) => {
        requestedModels.push(request.model);
        return { content: JSON.stringify({ markdown: "# Work Product" }), model: request.model!, provider: "openai" };
      } },
      matterId: matter.id,
      step: { ...step, parameters: { ...step.parameters, model } },
      workflowDefinitionId: eminentDomainCaseAssessmentDefinition.id,
      workflowRunId: workflowRun.id,
    });
    expect(output.status).toBe("completed");
    expect(requestedModels).toEqual([model, model]);
    expect(output.model).toBe(model);
  },
);
