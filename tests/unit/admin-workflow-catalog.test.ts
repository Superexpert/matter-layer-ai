import { WorkflowSource, type Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  normalizeAdminWorkflowDetail,
  normalizeAdminWorkflowSummary,
  summarizeWorkflowStepConfiguration,
} from "../../services/workflows/admin-workflow-catalog";

const workflowDefinition = {
  description: "Create a chronology from selected matter documents.",
  id: "chronology",
  name: "Chronology",
  steps: [
    {
      description: "Choose source documents.",
      id: "select-source-files",
      name: "Select source documents",
      parameters: {
        allowUpload: true,
        maxFiles: 3,
        minFiles: 1,
      },
      type: "fileSelector",
    },
    {
      autorun: true,
      description: "Extract chronology facts.",
      id: "extract-chronology",
      name: "Prepare source documents",
      parameters: {
        inputStepId: "select-source-files",
        profile: "chronology",
        representationType: "MARKDOWN",
      },
      type: "extraction",
    },
  ],
};

const workflowRow = {
  definitionJson: workflowDefinition as Prisma.JsonValue,
  isEnabled: true,
  isSystem: false,
  slug: "chronology",
  source: WorkflowSource.builtIn,
};

describe("admin workflow catalog normalization", () => {
  it("normalizes workflow summaries without exposing step implementation details", () => {
    expect(normalizeAdminWorkflowSummary(workflowRow)).toEqual({
      description: "Create a chronology from selected matter documents.",
      id: "chronology",
      isBuiltIn: true,
      isEnabled: true,
      isSystem: false,
      name: "Chronology",
      source: "builtIn",
      stepCount: 2,
    });
  });

  it("normalizes workflow details with ordered display steps", () => {
    const detail = normalizeAdminWorkflowDetail(workflowRow);

    expect(detail.steps).toMatchObject([
      {
        description: "Choose source documents.",
        id: "select-source-files",
        name: "Select source documents",
        type: "fileSelector",
        typeLabel: "File Selector",
      },
      {
        description: "Extract chronology facts.",
        id: "extract-chronology",
        name: "Prepare source documents",
        type: "extraction",
        typeLabel: "Extraction",
      },
    ]);
    expect(detail.steps[0].configurationSummary).toEqual([
      "Allows document upload.",
      "Select 1-3 documents.",
    ]);
    expect(detail.steps[1].configurationSummary).toEqual([
      "Uses output from select-source-files.",
      "Extraction profile: Chronology.",
    ]);
  });

  it("summarizes only useful configuration labels", () => {
    expect(
      summarizeWorkflowStepConfiguration({
        description: "Generate a workflow draft.",
        id: "generate-draft",
        name: "Generate Draft Workflow",
        parameters: {
          outputMode: "workflowDefinitionDraft",
          purpose: "Infer a draft workflow.",
          systemPrompt: "Long prompt that should not be exposed in the UI.",
        },
        type: "ai",
      }),
    ).toEqual([
      "Infer a draft workflow.",
      "AI output: Workflow Definition Draft.",
    ]);
  });
});
