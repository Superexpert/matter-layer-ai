"use client";

import { useEffect, useMemo, useState } from "react";

import type { WorkflowStepDefinition } from "@/services/workflows/types";
import {
  normalizeExtractionStepConfig,
  type ExtractionStepOutput,
} from "./schema";
import type { ExtractionStepState } from "./server";

type ExtractionStepComponentProps = {
  matterId: string;
  onComplete: (output: ExtractionStepOutput) => void;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
  loadStepState: (input: {
    matterId: string;
    step: WorkflowStepDefinition;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<ExtractionStepState>;
  runStep: (input: {
    matterId: string;
    step: WorkflowStepDefinition;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<ExtractionStepOutput>;
};

function summaryForOutput(output: ExtractionStepOutput | null) {
  if (!output) {
    return "Selected documents have not been prepared yet.";
  }

  if (output.status === "completed") {
    return `${output.readyRepresentationCount} document${output.readyRepresentationCount === 1 ? "" : "s"} ready for extraction.`;
  }

  if (output.status === "partial_failed") {
    return `${output.failedRepresentationCount} document${output.failedRepresentationCount === 1 ? "" : "s"} could not be prepared.`;
  }

  return "Selected documents could not be prepared.";
}

export function ExtractionStepComponent({
  loadStepState,
  matterId,
  onComplete,
  runStep,
  step,
  workflowDefinitionId,
  workflowRunId,
}: ExtractionStepComponentProps) {
  const config = useMemo(
    () => normalizeExtractionStepConfig(step.parameters),
    [step.parameters],
  );
  const [state, setState] = useState<ExtractionStepState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isCurrent = true;

    async function loadState() {
      if (isCurrent) {
        setIsLoading(true);
        setErrorMessage("");
      }

      try {
        const nextState = await loadStepState({
          matterId,
          step,
          workflowDefinitionId,
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
              : "Matter Layer could not load the extraction step.",
          );
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadState();

    return () => {
      isCurrent = false;
    };
  }, [loadStepState, matterId, step, workflowDefinitionId, workflowRunId]);

  async function prepareDocuments() {
    setIsRunning(true);
    setErrorMessage("");

    try {
      const output = await runStep({
        matterId,
        step,
        workflowDefinitionId,
        workflowRunId,
      });
      const nextState = await loadStepState({
        matterId,
        step,
        workflowDefinitionId,
        workflowRunId,
      });

      setState({
        ...nextState,
        latestOutput: output,
      });

      if (output.status !== "completed") {
        setErrorMessage(summaryForOutput(output));
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not prepare the selected documents.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  const latestOutput = state?.latestOutput ?? null;
  const canContinue = latestOutput?.status === "completed";

  return (
    <section className="grid gap-5" data-testid="extraction-step">
      <div>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
          Active Workflow
        </p>
        <h2 className="mt-2 text-lg font-semibold text-[#211B27]">
          {step.name}
        </h2>
        {step.description ? (
          <p className="mt-1 text-sm leading-6 text-[#74677F]">
            {step.description}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
        <h3 className="text-base font-semibold text-[#211B27]">
          Selected documents
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#74677F]">
          Profile: {config.profile}
        </p>

        {isLoading ? (
          <p className="mt-4 rounded-lg border border-[#E3DEEA] bg-white p-3 text-sm leading-6 text-[#74677F]">
            Loading selected documents...
          </p>
        ) : state?.documents.length ? (
          <div className="mt-4 grid gap-2" data-testid="extraction-document-list">
            {state.documents.map((document) => (
              <div
                className="rounded-lg border border-[#E3DEEA] bg-white p-3"
                data-testid={`extraction-document-${document.id}`}
                key={document.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#211B27]">
                      {document.fileName}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#74677F]">
                      {document.mimeType}
                    </p>
                  </div>
                  <span className="rounded-full border border-[#CFC5DA] bg-[#FBFAFC] px-2 py-1 text-xs font-semibold text-[#4B3861]">
                    {document.representationStatus}
                  </span>
                </div>
                {document.error ? (
                  <p className="mt-2 text-sm leading-5 text-red-700">
                    {document.error}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p
            className="mt-4 rounded-lg border border-dashed border-[#CFC5DA] bg-white p-4 text-sm leading-6 text-[#74677F]"
            data-testid="extraction-empty-state"
          >
            Select source documents before preparing extraction.
          </p>
        )}
      </div>

      <div
        className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4"
        data-testid="extraction-summary"
      >
        <h3 className="text-base font-semibold text-[#211B27]">
          Preparation status
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#74677F]">
          {isRunning ? "Preparing selected documents..." : summaryForOutput(latestOutput)}
        </p>
      </div>

      {errorMessage ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
          data-testid="extraction-error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC] disabled:cursor-not-allowed disabled:text-[#A79AB4]"
          data-testid="extraction-run-button"
          disabled={isLoading || isRunning || !state?.documents.length}
          onClick={() => {
            void prepareDocuments();
          }}
          type="button"
        >
          {isRunning ? "Preparing..." : "Prepare source documents"}
        </button>
        <button
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]"
          data-testid="extraction-continue"
          disabled={!canContinue}
          onClick={() => {
            if (latestOutput) {
              onComplete(latestOutput);
            }
          }}
          type="button"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
