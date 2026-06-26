import { expect, test } from "@playwright/test";

import {
  createDefaultWorkflowStep,
  generateWorkflowDraftFromGoal,
  savedWorkflowFromDraft,
} from "../../services/workflows/workflow-builder-service";
import { validateWorkflowDefinitionDraft } from "../../services/workflows/validation";

test("Workflow Builder generates an Original Petition for Divorce draft", () => {
  const draft = generateWorkflowDraftFromGoal("Draft an Original Petition for Divorce");

  expect(draft).toMatchObject({
    name: "Original Petition for Divorce",
    steps: [
      {
        type: "form",
      },
      {
        type: "ai",
      },
      {
        type: "documentEditor",
      },
      {
        type: "saveDocument",
      },
    ],
  });
  expect(validateWorkflowDefinitionDraft(draft).valid).toBe(true);
});

test("Workflow Builder generates a chronology draft", () => {
  const draft = generateWorkflowDraftFromGoal(
    "Create a chronology from selected matter documents",
  );

  expect(draft).toMatchObject({
    name: "Chronology",
    steps: [
      {
        type: "fileSelector",
      },
      {
        type: "extraction",
      },
      {
        type: "ai",
      },
      {
        type: "documentEditor",
      },
      {
        type: "saveDocument",
      },
    ],
  });
  expect(validateWorkflowDefinitionDraft(draft).valid).toBe(true);
});

test("Workflow Builder generates a routing draft", () => {
  const draft = generateWorkflowDraftFromGoal(
    "Route simple and complex divorce matters",
  );

  expect(draft).toMatchObject({
    name: "Divorce Workflow Router",
    steps: [
      {
        type: "form",
      },
      {
        type: "decision",
      },
      {
        type: "runWorkflow",
      },
    ],
  });
  expect(validateWorkflowDefinitionDraft(draft).valid).toBe(true);
});

test("Workflow Builder creates default editor steps and saved workflows", () => {
  const step = createDefaultWorkflowStep("ai", 2);
  const savedWorkflow = savedWorkflowFromDraft({
    description: "Generate a draft.",
    id: "draft-workflow",
    name: "Custom Draft",
    steps: [step],
  });

  expect(step).toMatchObject({
    name: "Generate Output",
    parameters: {
      outputMode: "documentDraft",
    },
    type: "ai",
  });
  expect(savedWorkflow).toMatchObject({
    id: "custom-custom-draft",
    name: "Custom Draft",
  });
  expect(validateWorkflowDefinitionDraft(savedWorkflow).valid).toBe(true);
});
