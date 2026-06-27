import { describe, expect, it } from "vitest";

import { validateWorkflowDefinitionDraft } from "../../services/workflows/validation";
import { generateWorkflowDraftFromGoal } from "../../services/workflows/workflow-builder-service";
import { chronologyDefinition } from "../../workflows/chronology.workflow";

describe("workflow step autorun metadata", () => {
  it("allows workflow step definitions to opt into autorun", () => {
    const result = validateWorkflowDefinitionDraft({
      description: "Run an automatic step.",
      id: "autorun-workflow",
      name: "Autorun Workflow",
      steps: [
        {
          autorun: true,
          description: "Run automatically.",
          id: "automatic-step",
          name: "Automatic Step",
          parameters: {},
          type: "extraction",
        },
      ],
    });

    expect(result).toEqual({
      messages: [],
      valid: true,
    });
  });

  it("configures the built-in Chronology extraction step for autorun", () => {
    const extractionStep = chronologyDefinition.steps.find(
      (step) => step.id === "extract-chronology",
    );

    expect(extractionStep).toMatchObject({
      autorun: true,
      type: "extraction",
    });
  });

  it("configures generated chronology extraction steps for autorun", () => {
    const generatedWorkflow = generateWorkflowDraftFromGoal(
      "Create a chronology from selected matter documents",
    );
    const extractionStep = generatedWorkflow.steps.find(
      (step) => step.type === "extraction",
    );

    expect(extractionStep).toMatchObject({
      autorun: true,
    });
  });
});
