"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkflowStepDefinition } from "@/services/workflows/types";
import {
  normalizeExtractionStepConfig,
  type ExtractionStepOutput,
} from "./schema";
import type { ExtractionStepState } from "./server";
import { suggestedActionForError } from "./errors";
import { headingForOutputError, summaryForOutput } from "./display-copy";

type ExtractionStepComponentProps = {
  matterId: string;
  onComplete: (output: ExtractionStepOutput) => void;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
  onReturnToInputStep?: (inputStepId: string) => void;
  loadStepState: (input: {
    matterId: string;
    step: WorkflowStepDefinition;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<ExtractionStepState>;
  runStep: (input: {
    executionMode?: "autorun" | "manual";
    matterId: string;
    step: WorkflowStepDefinition;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<ExtractionStepOutput>;
};

export function ExtractionStepComponent({
  loadStepState,
  matterId,
  onComplete,
  onReturnToInputStep,
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
  const autorunStartedKeyRef = useRef<string | null>(null);
  const autorunAdvancedRunIdRef = useRef<string | null>(null);

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

  const prepareDocuments = useCallback(async (executionMode: "autorun" | "manual" = "manual") => {
    setIsRunning(true);
    setErrorMessage("");

    try {
      const output = await runStep({
        executionMode,
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
      if (executionMode === "autorun" && output.status === "completed") {
        autorunAdvancedRunIdRef.current = output.extractionRunId;
        onComplete(output);
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
  }, [
    loadStepState,
    matterId,
    onComplete,
    runStep,
    step,
    workflowDefinitionId,
    workflowRunId,
  ]);

  const latestOutput = state?.latestOutput ?? null;
  const outputError = latestOutput?.error ?? null;
  const suggestedAction = suggestedActionForError(outputError);
  const canContinue = latestOutput?.status === "completed";
  const shouldShowRunButton =
    !step.autorun ||
    latestOutput?.status === "failed" ||
    latestOutput?.status === "partial_failed";

  useEffect(() => {
    if (!step.autorun || isLoading || isRunning || !state?.documents.length) {
      return;
    }

    if (latestOutput?.status === "completed") {
      if (autorunAdvancedRunIdRef.current !== latestOutput.extractionRunId) {
        autorunAdvancedRunIdRef.current = latestOutput.extractionRunId;
        onComplete(latestOutput);
      }

      return;
    }

    if (
      latestOutput?.status === "failed" ||
      latestOutput?.status === "partial_failed" ||
      latestOutput?.status === "running"
    ) {
      return;
    }

    const autorunKey = `${workflowRunId}:${step.id}`;

    if (autorunStartedKeyRef.current === autorunKey) {
      return;
    }

    autorunStartedKeyRef.current = autorunKey;
    void prepareDocuments("autorun");
  }, [
    isLoading,
    isRunning,
    latestOutput,
    onComplete,
    prepareDocuments,
    state?.documents.length,
    step.autorun,
    step.id,
    workflowRunId,
  ]);

  useEffect(() => {
    if (latestOutput?.status !== "running") {
      return;
    }

    let isCurrent = true;
    const timeoutId = window.setTimeout(async () => {
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
              : "Matter Layer could not refresh the extraction step.",
          );
        }
      }
    }, 1500);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    latestOutput?.status,
    loadStepState,
    matterId,
    step,
    workflowDefinitionId,
    workflowRunId,
  ]);

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
          {isRunning || (step.autorun && !latestOutput)
            ? "Preparing selected documents..."
            : summaryForOutput(latestOutput)}
        </p>
        {outputError ? (
          <div
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
            data-testid="extraction-structured-error"
          >
            <p className="font-semibold">
              {headingForOutputError(latestOutput)}
            </p>
            <p className="mt-1">{outputError.userMessage}</p>
            {outputError.documentErrors?.length ? (
              <div className="mt-3">
                <p className="font-semibold">Files that need attention:</p>
                <ul className="mt-1 list-disc pl-5">
                  {outputError.documentErrors.map((documentError) => (
                    <li key={`${documentError.matterDocumentId}-${documentError.code}`}>
                      <span className="font-medium">
                        {documentError.fileName ?? documentError.matterDocumentId}:
                      </span>{" "}
                      {documentError.userMessage}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {suggestedAction ? (
              <p className="mt-3" data-testid="extraction-suggested-action">
                {suggestedAction}
              </p>
            ) : null}
          </div>
        ) : null}
        {latestOutput ? (
          <div className="mt-2 grid gap-1 text-xs leading-5 text-[#74677F]">
            <p>
              {Object.entries(latestOutput.factsByType)
                .filter(([, count]) => count > 0)
                .map(([factType, count]) => `${count} ${factType.replace(/_/g, " ")}`)
                .join(", ") || "No chronology facts extracted yet."}
            </p>
            {latestOutput.chronologyArtifactId ? (
              <p data-testid="chronology-artifact-created">
                Chronology draft generated.
              </p>
            ) : null}
          </div>
        ) : null}
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
        {shouldShowRunButton ? (
          <button
            className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC] disabled:cursor-not-allowed disabled:text-[#A79AB4]"
            data-testid="extraction-run-button"
            disabled={isLoading || isRunning || !state?.documents.length}
            onClick={() => {
              void prepareDocuments("manual");
            }}
            type="button"
          >
            {isRunning
              ? "Extracting..."
              : step.autorun
                ? "Retry extraction"
                : latestOutput?.status === "failed" || latestOutput?.status === "partial_failed"
                  ? "Try preparing again"
                  : "Extract chronology facts"}
          </button>
        ) : (
          <div />
        )}
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
      {latestOutput?.status === "failed" && onReturnToInputStep ? (
        <button
          className="justify-self-start text-sm font-semibold text-[#5F4B76] underline-offset-4 hover:underline"
          data-testid="extraction-return-to-input-step"
          onClick={() => onReturnToInputStep(config.inputStepId)}
          type="button"
        >
          Return to Select source documents
        </button>
      ) : null}
    </section>
  );
}
