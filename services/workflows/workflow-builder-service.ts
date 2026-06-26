import type { WorkflowBuilderState, WorkflowDefinition, WorkflowStepDefinition } from "./types";

function kebabCase(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workflow"
  );
}

function titleFromGoal(goal: string) {
  const normalizedGoal = goal
    .trim()
    .replace(/^draft\s+(an?\s+)?/i, "")
    .replace(/^create\s+(an?\s+)?/i, "")
    .replace(/^prepare\s+(an?\s+)?/i, "")
    .replace(/^build\s+(an?\s+)?/i, "")
    .replace(/\.$/, "");

  return normalizedGoal
    .split(/\s+/)
    .map((word) =>
      word.length <= 2
        ? word.toLowerCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

function step(
  id: string,
  type: string,
  name: string,
  description: string,
  parameters: Record<string, unknown> = {},
): WorkflowStepDefinition {
  return {
    description,
    id,
    name,
    parameters,
    type,
  };
}

export function initialWorkflowBuilderState(): WorkflowBuilderState {
  return {
    approvedWorkflowDefinition: null,
    draftWorkflowDefinition: null,
    goal: "",
    status: "definingGoal",
  };
}

export function createDefaultWorkflowStep(
  type: string,
  index: number,
): WorkflowStepDefinition {
  const suffix = index + 1;

  if (type === "fileSelector") {
    return step(
      `select-files-${suffix}`,
      "fileSelector",
      "Select Matter Files",
      "Choose the matter files to use as source material.",
      {
        acceptedMimeTypes: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "text/plain",
        ],
        allowExistingMatterFiles: true,
        allowUpload: true,
        maxFiles: null,
        minFiles: 1,
      },
    );
  }

  if (type === "form") {
    return step(
      `collect-inputs-${suffix}`,
      "form",
      "Collect Inputs",
      "Ask structured questions needed for this workflow.",
    );
  }

  if (type === "extraction") {
    return step(
      `extract-information-${suffix}`,
      "extraction",
      "Extract Information",
      "Extract structured facts or events from selected matter documents.",
    );
  }

  if (type === "ai") {
    return step(
      `generate-output-${suffix}`,
      "ai",
      "Generate Output",
      "Generate, transform, classify, or reason over workflow information.",
      {
        outputMode: "documentDraft",
        systemPrompt: "Generate the requested workflow output.",
      },
    );
  }

  if (type === "documentEditor") {
    return step(
      `review-document-${suffix}`,
      "documentEditor",
      "Review Document",
      "Display an editable document for lawyer review.",
    );
  }

  if (type === "saveDocument") {
    return step(
      `save-document-${suffix}`,
      "saveDocument",
      "Save Document",
      "Save the reviewed document to the matter.",
      {
        format: "docx",
      },
    );
  }

  if (type === "runWorkflow") {
    return step(
      `run-workflow-${suffix}`,
      "runWorkflow",
      "Run Workflow",
      "Start another workflow.",
      {
        workflowId: "",
      },
    );
  }

  if (type === "decision") {
    return step(
      `route-workflow-${suffix}`,
      "decision",
      "Route Workflow",
      "Route the workflow based on structured conditions.",
      {
        conditions: [],
      },
    );
  }

  throw new Error(`Cannot create default step for unsupported type: ${type}`);
}

export function generateWorkflowDraftFromGoal(goal: string): WorkflowDefinition {
  const normalizedGoal = goal.toLowerCase();

  if (
    normalizedGoal.includes("original petition for divorce") ||
    (normalizedGoal.includes("divorce") && normalizedGoal.includes("petition"))
  ) {
    return {
      description: "Draft and review an Original Petition for Divorce from structured case details.",
      id: "draft-workflow",
      name: "Original Petition for Divorce",
      steps: [
        step(
          "collect-petition-details",
          "form",
          "Collect Petition Details",
          "Collect the information needed to draft the Original Petition for Divorce.",
        ),
        step(
          "generate-petition",
          "ai",
          "Generate Petition",
          "Generate a draft Original Petition for Divorce from the collected case details.",
          {
            outputMode: "documentDraft",
            systemPrompt: "Draft an Original Petition for Divorce from the collected case details.",
          },
        ),
        step(
          "review-petition",
          "documentEditor",
          "Review Petition",
          "Display the draft petition for lawyer review and edits.",
        ),
        step(
          "save-petition",
          "saveDocument",
          "Save Petition",
          "Save the reviewed petition to the matter.",
          {
            format: "docx",
          },
        ),
      ],
    };
  }

  if (
    normalizedGoal.includes("chronology") ||
    normalizedGoal.includes("timeline")
  ) {
    return {
      description: "Create a chronology from selected matter documents.",
      id: "draft-workflow",
      name: "Chronology",
      steps: [
        step(
          "select-files",
          "fileSelector",
          "Select Matter Files",
          "Choose matter documents to include in the chronology.",
          {
            acceptedMimeTypes: [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "text/plain",
            ],
            allowExistingMatterFiles: true,
            allowUpload: true,
            maxFiles: null,
            minFiles: 1,
          },
        ),
        step(
          "extract-events",
          "extraction",
          "Extract Events",
          "Extract dates, events, people, and source references from selected documents.",
        ),
        step(
          "generate-chronology",
          "ai",
          "Generate Chronology",
          "Generate an ordered chronology from the extracted events.",
          {
            outputMode: "documentDraft",
            systemPrompt: "Generate a concise legal chronology from extracted events.",
          },
        ),
        step(
          "review-chronology",
          "documentEditor",
          "Review Chronology",
          "Review and edit the chronology.",
        ),
        step(
          "save-chronology",
          "saveDocument",
          "Save Chronology",
          "Save the reviewed chronology to the matter.",
          {
            format: "docx",
          },
        ),
      ],
    };
  }

  if (
    normalizedGoal.includes("route") ||
    normalizedGoal.includes("routing") ||
    (normalizedGoal.includes("simple") && normalizedGoal.includes("complex"))
  ) {
    return {
      description: "Route simple and complex divorce matters to the appropriate workflow.",
      id: "draft-workflow",
      name: "Divorce Workflow Router",
      steps: [
        step(
          "collect-routing-answers",
          "form",
          "Collect Routing Answers",
          "Ask questions needed to decide whether the matter is simple or complex.",
        ),
        step(
          "route-matter",
          "decision",
          "Route Matter",
          "Route based on matter complexity.",
          {
            conditions: [
              {
                if: "matterComplexity == simple",
                then: "run-simple-divorce-workflow",
              },
              {
                if: "matterComplexity == complex",
                then: "run-complex-divorce-workflow",
              },
            ],
          },
        ),
        step(
          "run-selected-workflow",
          "runWorkflow",
          "Run Selected Workflow",
          "Start the selected divorce workflow.",
          {
            workflowId: "",
          },
        ),
      ],
    };
  }

  const name = titleFromGoal(goal);

  return {
    description: `Build a workflow to ${goal.trim().replace(/\.$/, "")}.`,
    id: "draft-workflow",
    name,
    steps: [
      createDefaultWorkflowStep("form", 0),
      createDefaultWorkflowStep("ai", 1),
      createDefaultWorkflowStep("documentEditor", 2),
      createDefaultWorkflowStep("saveDocument", 3),
    ],
  };
}

export function savedWorkflowFromDraft(draftWorkflow: WorkflowDefinition) {
  return {
    ...draftWorkflow,
    id:
      draftWorkflow.id === "draft-workflow"
        ? `custom-${kebabCase(draftWorkflow.name)}`
        : draftWorkflow.id,
    steps: draftWorkflow.steps.map((stepDefinition) => ({
      ...stepDefinition,
      parameters: { ...stepDefinition.parameters },
    })),
  };
}
