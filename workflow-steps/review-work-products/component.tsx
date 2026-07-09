"use client";

import { useEffect, useState } from "react";

import type {
  EditableWorkflowArtifact,
  WorkflowRunDetails,
} from "@/services/workflows/workflow-run-service";
import { DocumentEditorSurface } from "@/workflow-steps/document-editor/component";

export type ReviewWorkProductsStepState = {
  editableWorkProducts: EditableWorkflowArtifact[];
  workflowRun: WorkflowRunDetails;
};

type ReviewWorkProductsSavePayload = {
  contentMarkdown: string;
  editorJson: unknown;
};

type ReviewWorkProductsStepComponentProps = {
  completeWorkflowRun: (input: {
    matterId: string;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<void>;
  loadStepState: (input: {
    matterId: string;
    workflowRunId: string;
  }) => Promise<ReviewWorkProductsStepState>;
  matterId: string;
  onWorkflowRunCompleted?: () => Promise<void>;
  saveWorkProduct: (input: {
    artifactId: string;
    contentMarkdown: string;
    editorJson?: unknown;
    matterId: string;
    workflowRunId: string;
  }) => Promise<EditableWorkflowArtifact>;
  workflowDefinitionId: string;
  workflowName: string;
  workflowRunId: string;
};

function completionSummary(workflowRun: WorkflowRunDetails) {
  const workProductCount = workflowRun.workProducts.length;
  const caseFileCount = workflowRun.inputCaseFileCount;

  return `Matter Layer created ${workProductCount} work product${workProductCount === 1 ? "" : "s"} from ${caseFileCount} case file${caseFileCount === 1 ? "" : "s"}.`;
}

export function ReviewWorkProductsStepComponent({
  completeWorkflowRun,
  loadStepState,
  matterId,
  onWorkflowRunCompleted,
  saveWorkProduct,
  workflowDefinitionId,
  workflowName,
  workflowRunId,
}: ReviewWorkProductsStepComponentProps) {
  const [state, setState] = useState<ReviewWorkProductsStepState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isCurrent = true;

    async function loadReviewStep() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        await completeWorkflowRun({
          matterId,
          workflowDefinitionId,
          workflowRunId,
        });
        await onWorkflowRunCompleted?.();
        const nextState = await loadStepState({
          matterId,
          workflowRunId,
        });

        if (isCurrent) {
          setState(nextState);
        }
      } catch (error) {
        if (isCurrent) {
          setErrorMessage(
            error instanceof Error && error.message.trim()
              ? error.message
              : "Matter Layer could not load the generated work products.",
          );
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadReviewStep();

    return () => {
      isCurrent = false;
    };
  }, [
    completeWorkflowRun,
    loadStepState,
    matterId,
    onWorkflowRunCompleted,
    workflowDefinitionId,
    workflowRunId,
  ]);

  async function saveArtifact(
    artifactId: string,
    payload: ReviewWorkProductsSavePayload,
  ) {
    const savedArtifact = await saveWorkProduct({
      artifactId,
      contentMarkdown: payload.contentMarkdown,
      editorJson: payload.editorJson,
      matterId,
      workflowRunId,
    });

    setState((currentState) => {
      if (!currentState) {
        return currentState;
      }

      return {
        ...currentState,
        editableWorkProducts: currentState.editableWorkProducts.map((artifact) =>
          artifact.artifactId === savedArtifact.artifactId ? savedArtifact : artifact,
        ),
      };
    });

    return savedArtifact;
  }

  return (
    <section className="grid gap-6" data-testid="review-work-products-step">
      <div className="border-b border-[#E3DEEA] pb-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
          Review Work Products
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[#211B27]">
          {workflowName} Complete
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#74677F]">
          {state ? completionSummary(state.workflowRun) : "Loading generated work products..."}
        </p>
      </div>

      {errorMessage ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
          data-testid="review-work-products-error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      {isLoading ? (
        <p className="rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#74677F]">
          Loading generated work products...
        </p>
      ) : state?.editableWorkProducts.length ? (
        <div className="grid gap-8">
          {state.editableWorkProducts.map((artifact) => (
            <div
              data-testid={`review-work-product-${artifact.artifactId}`}
              key={artifact.artifactId}
            >
              <DocumentEditorSurface
                contentHtml={artifact.editorContentHtml}
                errorFallback="Matter Layer could not save this work product."
                exportButtonLabel="Export DOCX"
                hideCompletionButton
                isLoading={false}
                onDone={() => undefined}
                onSave={(payload) => saveArtifact(artifact.artifactId, payload)}
                savedStatusLabel="Saved"
                saveButtonLabel="Save"
                title={artifact.title}
                unsavedStatusLabel="Unsaved changes"
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[#CFC5DA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#74677F]">
          No generated work products yet.
        </p>
      )}
    </section>
  );
}
