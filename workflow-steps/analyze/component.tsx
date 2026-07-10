"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkflowStepDefinition } from "@/services/workflows/types";
import type { AnalyzeStepState } from "./server";
import type { AnalyzeStepOutput } from "./schema";

type Props = {
  loadStepState: (input: { matterId: string; step: WorkflowStepDefinition; workflowDefinitionId: string; workflowRunId: string }) => Promise<AnalyzeStepState>;
  matterId: string;
  onComplete: (output: AnalyzeStepOutput) => void;
  runStep: (input: { executionMode?: "autorun" | "manual" | "retry_failed"; matterId: string; step: WorkflowStepDefinition; workflowDefinitionId: string; workflowRunId: string }) => Promise<AnalyzeStepOutput>;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
};

export function AnalyzeStepComponent(props: Props) {
  const {
    loadStepState,
    matterId,
    onComplete,
    runStep,
    step,
    workflowDefinitionId,
    workflowRunId,
  } = props;
  const [state, setState] = useState<AnalyzeStepState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const autorunStarted = useRef(false);

  const run = useCallback(async (executionMode: "autorun" | "manual" | "retry_failed") => {
    setIsRunning(true);
    setError("");
    try {
      const output = await runStep({ executionMode, matterId, step, workflowDefinitionId, workflowRunId });
      setState((current) => ({ effectiveAIProvider: current?.effectiveAIProvider ?? null, latestOutput: output }));
      if (output.status === "completed") onComplete(output);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Matter Layer could not analyze this matter.");
    } finally {
      setIsRunning(false);
    }
  }, [matterId, onComplete, runStep, step, workflowDefinitionId, workflowRunId]);

  useEffect(() => {
    let current = true;
    void loadStepState({ matterId, step, workflowDefinitionId, workflowRunId }).then((next) => {
      if (!current) return;
      setState(next);
      if (next.latestOutput?.status === "completed") {
        onComplete(next.latestOutput);
      } else if (step.autorun && !next.latestOutput && !autorunStarted.current) {
        autorunStarted.current = true;
        void run("autorun");
      }
    }).catch((loadError) => current && setError(loadError instanceof Error ? loadError.message : "Matter Layer could not load Analyze."));
    return () => { current = false; };
  }, [loadStepState, matterId, onComplete, run, step, workflowDefinitionId, workflowRunId]);

  useEffect(() => {
    if (state?.latestOutput?.status !== "running" || isRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadStepState({ matterId, step, workflowDefinitionId, workflowRunId })
        .then((next) => {
          setState(next);
          if (next.latestOutput?.status === "completed") onComplete(next.latestOutput);
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, loadStepState, matterId, onComplete, state?.latestOutput?.status, step, workflowDefinitionId, workflowRunId]);

  const output = state?.latestOutput;
  const partial = output?.status === "partial_failed";
  return <section className="grid gap-5" data-testid="analyze-step">
    <div className="border-b border-[#E3DEEA] pb-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">Analyze Case</p>
      <h2 className="mt-2 text-2xl font-semibold text-[#211B27]">{step.name}</h2>
      <p className="mt-2 text-sm leading-6 text-[#74677F]">{step.description}</p>
    </div>
    <div className="rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] p-4">
      <p className="text-sm font-semibold text-[#211B27]">Generating work products</p>
      <ul className="mt-3 grid gap-2">
        {(output?.generators ?? []).map((generator) => <li className="text-sm text-[#4B3861]" key={generator.id}>
          {generator.status === "completed" ? "✓" : generator.status === "failed" ? "✕" : "○"} {generator.name}
        </li>)}
        {!output ? <li className="text-sm text-[#74677F]">Waiting to begin...</li> : null}
      </ul>
    </div>
    {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p> : null}
    <div className="flex gap-2">
      {!step.autorun && !output ? <button className="rounded-md bg-[#5F4B76] px-4 py-2 text-sm font-semibold text-white" disabled={isRunning} onClick={() => void run("manual")} type="button">Analyze Case</button> : null}
      {(partial || output?.status === "failed") ? <button className="rounded-md bg-[#5F4B76] px-4 py-2 text-sm font-semibold text-white" disabled={isRunning} onClick={() => void run("retry_failed")} type="button">{isRunning ? "Retrying..." : "Retry"}</button> : null}
      {partial ? <button className="rounded-md border border-[#CFC5DA] bg-white px-4 py-2 text-sm font-semibold text-[#4B3861]" disabled={isRunning} onClick={() => onComplete(output)} type="button">Continue</button> : null}
    </div>
  </section>;
}
