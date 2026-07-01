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
import type { WorkflowActivityEvent } from "@/services/workflows/workflow-activity-service";
import type {
  WorkflowStepProgress,
  WorkflowStepProgressItem,
} from "@/services/workflows/workflow-step-progress";

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

function progressItemLabel(item: WorkflowStepProgressItem | null | undefined) {
  if (!item) {
    return null;
  }

  if (item.status === "completed") {
    return "Prepared";
  }

  if (item.status === "failed") {
    return "Failed";
  }

  if (item.status === "running") {
    if (item.phase === "extracting") {
      return "Extracting facts";
    }

    if (item.phase === "converting") {
      return "Converting";
    }

    return "Preparing";
  }

  if (item.status === "skipped") {
    return "Skipped";
  }

  return "Waiting";
}

function progressBadgeClass(status: WorkflowStepProgressItem["status"]) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (status === "running") {
    return "border-[#BCA9D4] bg-[#F3EEF8] text-[#4B3861]";
  }

  return "border-[#CFC5DA] bg-[#FBFAFC] text-[#4B3861]";
}

function progressBarWidth(progress: WorkflowStepProgress | null | undefined) {
  if (typeof progress?.percentComplete === "number") {
    return `${Math.min(100, Math.max(0, progress.percentComplete))}%`;
  }

  if (
    typeof progress?.completedItems === "number" &&
    typeof progress.totalItems === "number" &&
    progress.totalItems > 0
  ) {
    return `${Math.round((progress.completedItems / progress.totalItems) * 100)}%`;
  }

  return "35%";
}

function activeProgressPosition(progress: WorkflowStepProgress | null | undefined) {
  const currentItemId = progress?.currentItemId;
  const items = progress?.items ?? [];

  if (!currentItemId || items.length === 0) {
    return null;
  }

  const currentIndex = items.findIndex((item) => item.id === currentItemId);

  if (currentIndex < 0) {
    return null;
  }

  return {
    current: currentIndex + 1,
    total: items.length,
  };
}

function activityLevelClass(level: WorkflowActivityEvent["level"]) {
  if (level === "error") {
    return "text-red-700";
  }

  if (level === "warning") {
    return "text-amber-700";
  }

  if (level === "success") {
    return "text-emerald-700";
  }

  if (level === "debug") {
    return "text-[#74677F]";
  }

  return "text-[#211B27]";
}

function formatActivityTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function debugWorkflowActivityUi(message: string, metadata: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info(`[workflow:activity-ui] ${message}`, metadata);
}

function localRunningOutput(input: {
  documents: ExtractionStepState["documents"];
  profile: ExtractionStepOutput["profile"];
  workflowRunId: string;
}): ExtractionStepOutput {
  return {
    chronologyArtifactId: null,
    collapsedEventCount: 0,
    collapsedEvents: [],
    error: null,
    extractedFactCount: 0,
    extractionRunId: `local-running-${input.workflowRunId}`,
    extractionWindowCount: 0,
    facts: [],
    factsByType: {},
    failedDocumentIds: [],
    failedRepresentationCount: 0,
    preparedDocumentIds: [],
    profile: input.profile,
    progress: {
      completedItems: 0,
      items: input.documents.map((document) => ({
        id: document.id,
        label: document.fileName,
        message: "Waiting to prepare",
        phase: "queued",
        percentComplete: 0,
        status: "waiting",
      })),
      message: "Preparing selected documents...",
      percentComplete: 0,
      status: "running",
      totalItems: input.documents.length,
    },
    readyRepresentationCount: 0,
    schemaVersion: 1,
    selectedMatterDocumentIds: input.documents.map((document) => document.id),
    status: "running",
  };
}

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
  const [sawRunningOutput, setSawRunningOutput] = useState(false);
  const [lastActivityPoll, setLastActivityPoll] = useState<string | null>(null);
  const [emptyActivityPollCount, setEmptyActivityPollCount] = useState(0);
  const autorunStartedKeyRef = useRef<string | null>(null);
  const autorunAdvancedRunIdRef = useRef<string | null>(null);
  const activityEndRef = useRef<HTMLDivElement | null>(null);

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
          if (nextState.latestOutput?.status === "running") {
            setSawRunningOutput(true);
            if (nextState.activityEvents.length > 0) {
              setEmptyActivityPollCount(0);
            }
          } else {
            setEmptyActivityPollCount(0);
          }
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
    setSawRunningOutput(true);
    setEmptyActivityPollCount(0);
    const currentDocuments = state?.documents ?? [];

    if (currentDocuments.length > 0) {
      setState((currentState) =>
        currentState
          ? {
              ...currentState,
              latestOutput: localRunningOutput({
                documents: currentDocuments,
                profile: config.profile,
                workflowRunId,
              }),
            }
          : currentState,
      );
    }

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

      setState((currentState) => {
        const currentOutput = currentState?.latestOutput;

        if (
          currentOutput?.status === "completed" ||
          currentOutput?.status === "failed" ||
          currentOutput?.status === "partial_failed"
        ) {
          return currentState;
        }

        return {
          ...nextState,
          latestOutput: nextState.latestOutput ?? output,
        };
      });
      if (nextState.latestOutput?.status !== "running" || nextState.activityEvents.length > 0) {
        setEmptyActivityPollCount(0);
      }
      if (executionMode === "autorun" && output.status === "completed") {
        autorunAdvancedRunIdRef.current = output.extractionRunId;
        window.setTimeout(() => {
          onComplete(output);
        }, 700);
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
    config.profile,
    loadStepState,
    matterId,
    onComplete,
    runStep,
    step,
    state?.documents,
    workflowDefinitionId,
    workflowRunId,
  ]);

  const latestOutput = state?.latestOutput ?? null;
  const activityEvents = state?.activityEvents ?? [];
  const progress = latestOutput?.progress ?? null;
  const progressItemsByDocumentId = useMemo(() => {
    return new Map(
      (progress?.items ?? []).map((item) => [item.id, item]),
    );
  }, [progress?.items]);
  const activeProgress = activeProgressPosition(progress);
  const outputError = latestOutput?.error ?? null;
  const suggestedAction = suggestedActionForError(outputError);
  const canContinue = latestOutput?.status === "completed";
  const activityDiagnosticVisible =
    latestOutput?.status === "running" &&
    activityEvents.length === 0 &&
    emptyActivityPollCount >= 6;
  const isShowingCompletionHold =
    step.autorun &&
    latestOutput?.status === "completed" &&
    sawRunningOutput;
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
        if (sawRunningOutput) {
          window.setTimeout(() => {
            onComplete(latestOutput);
          }, 700);
        } else {
          onComplete(latestOutput);
        }
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
    sawRunningOutput,
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
    let isPolling = false;
    const pollRunningStep = async () => {
      if (isPolling) {
        return;
      }

      isPolling = true;
      try {
        debugWorkflowActivityUi("polling", {
          stepId: step.id,
          workflowRunId,
        });
        const nextState = await loadStepState({
          matterId,
          step,
          workflowDefinitionId,
          workflowRunId,
        });

        if (isCurrent) {
          setLastActivityPoll(new Date().toISOString());
          debugWorkflowActivityUi("received events", {
            eventCount: nextState.activityEvents.length,
            latestEvent: nextState.activityEvents.at(-1)?.code ?? null,
            stepId: step.id,
            workflowRunId,
          });
          setState(nextState);
          if (nextState.latestOutput?.status === "running") {
            setSawRunningOutput(true);
            if (nextState.activityEvents.length === 0) {
              setEmptyActivityPollCount((currentCount) => currentCount + 1);
            } else {
              setEmptyActivityPollCount(0);
            }
          } else {
            setEmptyActivityPollCount(0);
          }
        }
      } catch (error) {
        if (isCurrent) {
          setErrorMessage(
            error instanceof Error && error.message.trim()
              ? error.message
              : "Matter Layer could not refresh the extraction step.",
          );
        }
      } finally {
        isPolling = false;
      }
    };
    const intervalId = window.setInterval(() => {
      void pollRunningStep();
    }, 750);

    void pollRunningStep();

    return () => {
      isCurrent = false;
      window.clearInterval(intervalId);
    };
  }, [
    latestOutput?.status,
    loadStepState,
    matterId,
    step,
    workflowDefinitionId,
    workflowRunId,
  ]);

  useEffect(() => {
    if (latestOutput?.status !== "running") {
      return;
    }

    activityEndRef.current?.scrollIntoView({
      block: "nearest",
    });
  }, [activityEvents.length, latestOutput?.status]);

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
            {state.documents.map((document) => {
              const progressItem = progressItemsByDocumentId.get(document.id);
              const documentStatusLabel =
                progressItemLabel(progressItem) ??
                (step.autorun ? "Queued" : document.representationStatus);
              const documentMessage =
                progressItem?.error?.userMessage ??
                progressItem?.message ??
                document.error ??
                (step.autorun ? "Waiting to prepare" : null);

              return (
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
                    <span
                      className={`rounded-full border px-2 py-1 text-xs font-semibold ${progressItem ? progressBadgeClass(progressItem.status) : "border-[#CFC5DA] bg-[#FBFAFC] text-[#4B3861]"}`}
                      data-testid={`extraction-document-status-${document.id}`}
                    >
                      {documentStatusLabel}
                    </span>
                  </div>
                  {documentMessage ? (
                    <p
                      className={`mt-2 text-sm leading-5 ${progressItem?.status === "failed" || document.error ? "text-red-700" : "text-[#74677F]"}`}
                      data-testid={`extraction-document-message-${document.id}`}
                    >
                      {documentMessage}
                    </p>
                  ) : null}
                  {progressItem?.status === "running" ? (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E3DEEA]">
                      <div
                        className="h-full rounded-full bg-[#5F4B76] transition-all animate-pulse"
                        style={{
                          width: `${progressItem.percentComplete ?? 35}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
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
          {isShowingCompletionHold
            ? "All documents prepared. Moving to Review chronology..."
            : isRunning || (step.autorun && !latestOutput)
            ? "Preparing selected documents..."
            : summaryForOutput(latestOutput)}
        </p>
        {progress?.currentItemLabel ? (
          <div
            className="mt-3 rounded-lg border border-[#E3DEEA] bg-white px-4 py-3"
            data-testid="extraction-active-document"
          >
            <p className="text-sm font-semibold text-[#211B27]">
              {activeProgress
                ? `Processing ${activeProgress.current} of ${activeProgress.total}: ${progress.currentItemLabel}`
                : `Processing: ${progress.currentItemLabel}`}
            </p>
            {progress.currentItemMessage ? (
              <p className="mt-1 text-sm leading-5 text-[#74677F]">
                {progress.currentItemMessage}
              </p>
            ) : null}
          </div>
        ) : null}
        {progress || isRunning || (step.autorun && !latestOutput) ? (
          <div className="mt-3" data-testid="extraction-global-progress">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-[#74677F]">
              <span>
                {typeof progress?.completedItems === "number" &&
                typeof progress.totalItems === "number"
                  ? `${progress.completedItems} of ${progress.totalItems} documents processed`
                  : "Preparing documents"}
              </span>
              {progress?.currentItemLabel ? (
                <span className="truncate">
                  Current: {progress.currentItemLabel}
                </span>
              ) : null}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E3DEEA]">
              <div
                className="h-full rounded-full bg-[#5F4B76] transition-all"
                data-testid="extraction-global-progress-bar"
                style={{
                  width: progressBarWidth(progress),
                }}
              />
            </div>
          </div>
        ) : null}
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
        <div
          className="mt-4 rounded-lg border border-[#E3DEEA] bg-white"
          data-testid="extraction-activity-log"
        >
          <div className="border-b border-[#E3DEEA] px-4 py-3">
            <h4 className="text-sm font-semibold text-[#211B27]">
              Activity
            </h4>
          </div>
          <div className="max-h-64 overflow-y-auto px-4 py-3">
            {activityEvents.length ? (
              <ol className="grid gap-2">
                {activityEvents.map((event) => (
                  <li
                    className="grid grid-cols-[4.75rem_1fr] gap-3 text-xs leading-5"
                    data-testid={`extraction-activity-${event.code}`}
                    key={event.id}
                  >
                    <time className="text-[#74677F]">
                      {formatActivityTimestamp(event.timestamp)}
                    </time>
                    <span className={activityLevelClass(event.level)}>
                      {event.message}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="grid gap-2">
                <p className="text-sm leading-6 text-[#74677F]">
                  Waiting for workflow activity...
                </p>
                {activityDiagnosticVisible ? (
                  <div
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"
                    data-testid="extraction-activity-diagnostic"
                  >
                    <p className="font-semibold">
                      Matter Layer thinks this step is running, but no activity events have been received yet.
                    </p>
                    <p className="mt-1">
                      This usually means the step is blocked before emitting activity, or the activity polling endpoint is not returning events.
                    </p>
                    {process.env.NODE_ENV === "development" ? (
                      <dl className="mt-2 grid gap-1">
                        <div>
                          <dt className="inline font-semibold">workflowRunId: </dt>
                          <dd className="inline">{workflowRunId}</dd>
                        </div>
                        <div>
                          <dt className="inline font-semibold">stepId: </dt>
                          <dd className="inline">{step.id}</dd>
                        </div>
                        <div>
                          <dt className="inline font-semibold">last poll: </dt>
                          <dd className="inline">{lastActivityPoll ?? "not yet"}</dd>
                        </div>
                        <div>
                          <dt className="inline font-semibold">activity events returned: </dt>
                          <dd className="inline">0</dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
            <div ref={activityEndRef} />
          </div>
        </div>
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
