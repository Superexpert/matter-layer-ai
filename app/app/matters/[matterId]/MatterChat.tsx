"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { SignOutButton } from "@/app/components/SignOutButton";
import { AppContainer } from "@/components/app-container";
import type { AIMessage } from "@/services/ai/types";
import {
  createDefaultWorkflowStep,
  generateWorkflowDraftFromGoal,
  initialWorkflowBuilderState,
  isWorkflowStepType,
  validateWorkflowDefinitionDraft,
  workflowStepRegistry,
  type WorkflowBuilderStepId,
  type WorkflowBuilderState,
  type WorkflowCatalogItem,
  type WorkflowDefinition,
  type WorkflowStepDefinition,
} from "@/services/workflows";
import { ExtractionStepComponent } from "@/workflow-steps/extraction/component";
import type { ExtractionStepOutput } from "@/workflow-steps/extraction/schema";
import { DocumentEditorStepComponent } from "@/workflow-steps/document-editor/component";
import type { DocumentEditorStepOutput } from "@/workflow-steps/document-editor/schema";
import { FileSelectorStepComponent } from "@/workflow-steps/file-selector/component";
import type { FileSelectorStepOutput } from "@/workflow-steps/file-selector/schema";

import {
  deleteWorkflowAction,
  duplicateWorkflowAction,
  loadExtractionStepStateAction,
  loadDocumentEditorStepStateAction,
  loadFileSelectorStepStateAction,
  runExtractionStepAction,
  saveDocumentEditorArtifactAction,
  saveCustomWorkflowAction,
  saveFileSelectorSelectionAction,
  uploadFileSelectorFilesAction,
} from "./workflow-actions";

type ChatMessage = AIMessage & {
  id: string;
};

type MatterChatProps = {
  isAdmin: boolean;
  matterId: string;
  matterName: string;
  workflowDefinitions: WorkflowCatalogItem[];
};

type ChatStreamEvent =
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "done";
      message: {
        role: "assistant";
        content: string;
        provider: string;
        model: string;
      };
    }
  | {
      type: "error";
      error: string;
    };

type ChatErrorResponse = {
  error: string;
  redirectTo?: string;
};

type ActiveWorkflowState = {
  activeStepId: string;
  builderState: WorkflowBuilderState;
  completed: boolean;
  draftWorkflow: WorkflowDefinition | null;
  savedWorkflow: WorkflowDefinition | null;
  stepOutputs: Record<string, Record<string, unknown>>;
  validationMessages: string[];
  workflowRunId: string;
  workflowDefinition: WorkflowDefinition;
};

type MatterTab = "Chat" | "Workflows" | "Documents";

const actionCards = [
  {
    title: "Ask about this matter",
  },
  {
    title: "Start a workflow",
  },
  {
    title: "Add documents",
  },
];

const CHAT_AUTO_SCROLL_THRESHOLD = 120;
const WORKFLOW_EDITOR_STEP_TYPES = [
  "fileSelector",
  "form",
  "extraction",
  "ai",
  "documentEditor",
  "saveDocument",
  "runWorkflow",
  "decision",
];

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createWorkflowRunId() {
  return crypto.randomUUID();
}

function useChatAutoScroll(dependencies: readonly unknown[]) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const updateNearBottom = useCallback(() => {
    const scrollElement = scrollContainerRef.current;

    if (!scrollElement) {
      shouldAutoScrollRef.current = true;
      setIsNearBottom(true);
      return true;
    }

    const distanceFromBottom =
      scrollElement.scrollHeight -
      scrollElement.scrollTop -
      scrollElement.clientHeight;
    const nextIsNearBottom = distanceFromBottom < CHAT_AUTO_SCROLL_THRESHOLD;

    shouldAutoScrollRef.current = nextIsNearBottom;
    setIsNearBottom(nextIsNearBottom);

    return nextIsNearBottom;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scrollElement = scrollContainerRef.current;

    if (!scrollElement) {
      return;
    }

    scrollElement.scrollTo({
      behavior,
      top: scrollElement.scrollHeight,
    });
    shouldAutoScrollRef.current = true;
    setIsNearBottom(true);
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom("smooth");
    } else {
      updateNearBottom();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return {
    isNearBottom,
    scrollContainerRef,
    scrollToBottom,
    showJumpToLatest: !isNearBottom,
    updateNearBottom,
  };
}

function createWorkflowMessage(content: string): ChatMessage {
  return {
    content,
    id: createMessageId(),
    role: "assistant",
  };
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Partial<ChatStreamEvent>;

  if (event.type === "text-delta") {
    return typeof event.delta === "string";
  }

  if (event.type === "done") {
    return (
      Boolean(event.message) &&
      event.message?.role === "assistant" &&
      typeof event.message.content === "string"
    );
  }

  return event.type === "error" && typeof event.error === "string";
}

function parseServerSentEventFrame(frame: string) {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (!data) {
    return null;
  }

  const parsedValue: unknown = JSON.parse(data);

  if (!isChatStreamEvent(parsedValue)) {
    throw new Error("Unexpected chat stream event.");
  }

  return parsedValue;
}

function isChatErrorResponse(value: unknown): value is ChatErrorResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Partial<ChatErrorResponse>;

  return (
    typeof response.error === "string" &&
    (response.redirectTo === undefined || typeof response.redirectTo === "string")
  );
}

export function MatterChat({
  isAdmin,
  matterId,
  matterName,
  workflowDefinitions: initialWorkflowDefinitions,
}: MatterChatProps) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<MatterTab>("Workflows");
  const [draftMessage, setDraftMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeWorkflow, setActiveWorkflow] =
    useState<ActiveWorkflowState | null>(null);
  const [workflowDefinitions, setWorkflowDefinitions] =
    useState<WorkflowCatalogItem[]>(initialWorkflowDefinitions);
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | null>(
    null,
  );
  const [deleteCandidateWorkflow, setDeleteCandidateWorkflow] =
    useState<WorkflowCatalogItem | null>(null);
  const [pendingWorkflowAction, setPendingWorkflowAction] = useState<
    string | null
  >(null);
  const [workflowActionError, setWorkflowActionError] = useState("");
  const [workflowGoalInput, setWorkflowGoalInput] = useState("");
  const [editorWorkflow, setEditorWorkflow] =
    useState<WorkflowDefinition | null>(null);
  const [selectedWorkflowStepIndex, setSelectedWorkflowStepIndex] = useState(0);
  const [stepParameterText, setStepParameterText] = useState<
    Record<string, string>
  >({});
  const [stepParameterErrors, setStepParameterErrors] = useState<
    Record<string, string>
  >({});
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const workflowMenuContainerRef = useRef<HTMLDivElement>(null);
  const deleteDialogCancelRef = useRef<HTMLButtonElement>(null);
  const {
    scrollContainerRef,
    scrollToBottom,
    showJumpToLatest,
    updateNearBottom,
  } = useChatAutoScroll([messages, isPending, errorMessage]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    function closeMenuForOutsideClick(event: MouseEvent) {
      if (
        openWorkflowMenuId &&
        workflowMenuContainerRef.current &&
        !workflowMenuContainerRef.current.contains(event.target as Node)
      ) {
        setOpenWorkflowMenuId(null);
      }
    }

    document.addEventListener("mousedown", closeMenuForOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeMenuForOutsideClick);
    };
  }, [openWorkflowMenuId]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (deleteCandidateWorkflow) {
        setDeleteCandidateWorkflow(null);
        return;
      }

      setOpenWorkflowMenuId(null);
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [deleteCandidateWorkflow]);

  useEffect(() => {
    if (deleteCandidateWorkflow) {
      deleteDialogCancelRef.current?.focus();
    }
  }, [deleteCandidateWorkflow]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 256)}px`;
  }, [draftMessage]);

  function updateAssistantMessage(messageId: string, content: string) {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content,
            }
          : message,
      ),
    );
  }

  function appendAssistantMessageDelta(messageId: string, delta: string) {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: `${message.content}${delta}`,
            }
          : message,
      ),
    );
  }

  async function handleChatStream(
    response: Response,
    assistantMessageId: string,
  ) {
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("AI chat response did not include a stream.");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = parseServerSentEventFrame(frame);

        if (!event) {
          continue;
        }

        if (event.type === "text-delta") {
          appendAssistantMessageDelta(assistantMessageId, event.delta);
          continue;
        }

        if (event.type === "done") {
          updateAssistantMessage(assistantMessageId, event.message.content);
          continue;
        }

        throw new Error(
          "Matter Layer could not generate a response. Try again.",
        );
      }
    }

    buffer += decoder.decode();
    const remainingEvent = parseServerSentEventFrame(buffer);

    if (remainingEvent?.type === "text-delta") {
      appendAssistantMessageDelta(assistantMessageId, remainingEvent.delta);
    }

    if (remainingEvent?.type === "done") {
      updateAssistantMessage(assistantMessageId, remainingEvent.message.content);
    }

    if (remainingEvent?.type === "error") {
      throw new Error("Matter Layer could not generate a response. Try again.");
    }
  }

  function stopStreaming() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsPending(false);
  }

  function parameterTextFromWorkflow(workflow: WorkflowDefinition) {
    return Object.fromEntries(
      workflow.steps.map((step) => [
        step.id,
        JSON.stringify(step.parameters, null, 2),
      ]),
    );
  }

  function updateWorkflowEditor(nextWorkflow: WorkflowDefinition) {
    const validation = validateWorkflowDefinitionDraft(nextWorkflow);

    setEditorWorkflow(nextWorkflow);
    setActiveWorkflow((currentWorkflow) => {
      if (!currentWorkflow) {
        throw new Error("Workflow editor update requires an active workflow.");
      }

      return {
        ...currentWorkflow,
        builderState: {
          ...currentWorkflow.builderState,
          draftWorkflowDefinition: nextWorkflow,
          status: "editingWorkflow",
        },
        draftWorkflow: nextWorkflow,
        validationMessages: validation.messages,
      };
    });
  }

  function updateWorkflowStep(
    stepIndex: number,
    updater: (step: WorkflowStepDefinition) => WorkflowStepDefinition,
  ) {
    if (!editorWorkflow) {
      return;
    }

    updateWorkflowEditor({
      ...editorWorkflow,
      steps: editorWorkflow.steps.map((step, index) =>
        index === stepIndex ? updater(step) : step,
      ),
    });
  }

  function generateDraftWorkflow(goal: string) {
    const draftWorkflow = generateWorkflowDraftFromGoal(goal);
    const validation = validateWorkflowDefinitionDraft(draftWorkflow);

    setEditorWorkflow(draftWorkflow);
    setSelectedWorkflowStepIndex(0);
    setStepParameterText(parameterTextFromWorkflow(draftWorkflow));
    setStepParameterErrors({});
    setActiveWorkflow((currentWorkflow) => {
      if (!currentWorkflow) {
        throw new Error("Draft generation requires an active workflow.");
      }

      return {
        ...currentWorkflow,
        activeStepId: "edit-workflow",
        builderState: {
          ...currentWorkflow.builderState,
          draftWorkflowDefinition: draftWorkflow,
          goal,
          status: "editingWorkflow",
        },
        draftWorkflow,
        validationMessages: validation.messages,
      };
    });
    setMessages((currentMessages) => [
      ...currentMessages,
      createWorkflowMessage(
        `Draft workflow generated: ${draftWorkflow.name}. Edit it in the left panel, then save when it is valid.`,
      ),
    ]);
  }

  function startWorkflowBuilder() {
    const workflowDefinition = workflowDefinitions.find(
      (workflow) => workflow.id === "workflow-builder",
    );

    if (!workflowDefinition) {
      throw new Error("Workflow Builder definition is not registered.");
    }

    const activeStep = workflowDefinition.steps[0];

    if (!activeStep) {
      throw new Error("Workflow Builder must include an active step.");
    }

    const validation = validateWorkflowDefinitionDraft(null);

    setActiveWorkflow({
      activeStepId: activeStep.id as WorkflowBuilderStepId,
      builderState: initialWorkflowBuilderState(),
      completed: false,
      draftWorkflow: null,
      savedWorkflow: null,
      stepOutputs: {},
      validationMessages: validation.messages,
      workflowRunId: createWorkflowRunId(),
      workflowDefinition,
    });
    setEditorWorkflow(null);
    setStepParameterErrors({});
    setStepParameterText({});
    setSelectedWorkflowStepIndex(0);
    setWorkflowGoalInput("");
    setSelectedTab("Workflows");
    setMessages((currentMessages) => [
      ...currentMessages,
      createWorkflowMessage(
        "Workflow Builder is ready. Enter the workflow goal in the left panel to generate a draft.",
      ),
    ]);
    setErrorMessage("");
  }

  function startWorkflow(workflowDefinition: WorkflowDefinition) {
    if (workflowDefinition.id === "workflow-builder") {
      startWorkflowBuilder();
      return;
    }

    const activeStep = workflowDefinition.steps[0];

    if (!activeStep) {
      throw new Error(`${workflowDefinition.name} must include an active step.`);
    }

    setActiveWorkflow({
      activeStepId: activeStep.id,
      builderState: initialWorkflowBuilderState(),
      completed: false,
      draftWorkflow: null,
      savedWorkflow: null,
      stepOutputs: {},
      validationMessages: [],
      workflowRunId: createWorkflowRunId(),
      workflowDefinition,
    });
    setEditorWorkflow(null);
    setStepParameterErrors({});
    setStepParameterText({});
    setSelectedWorkflowStepIndex(0);
    setWorkflowGoalInput("");
    setErrorMessage("");
  }

  function submitWorkflowGoal() {
    const goal = workflowGoalInput.trim();

    if (!goal || !activeWorkflow) {
      return;
    }

    setActiveWorkflow({
      ...activeWorkflow,
      activeStepId: "generate-draft",
      builderState: {
        ...activeWorkflow.builderState,
        goal,
        status: "generatingDraft",
      },
      validationMessages: [],
    });
    window.setTimeout(() => generateDraftWorkflow(goal), 250);
  }

  function addWorkflowStep(type: string) {
    if (!editorWorkflow) {
      return;
    }

    const newStep = createDefaultWorkflowStep(type, editorWorkflow.steps.length);
    const nextWorkflow = {
      ...editorWorkflow,
      steps: [...editorWorkflow.steps, newStep],
    };

    setStepParameterText((currentText) => ({
      ...currentText,
      [newStep.id]: JSON.stringify(newStep.parameters, null, 2),
    }));
    setSelectedWorkflowStepIndex(nextWorkflow.steps.length - 1);
    updateWorkflowEditor(nextWorkflow);
  }

  function removeWorkflowStep(stepIndex: number) {
    if (!editorWorkflow) {
      return;
    }

    const removedStep = editorWorkflow.steps[stepIndex];
    const nextWorkflow = {
      ...editorWorkflow,
      steps: editorWorkflow.steps.filter((_, index) => index !== stepIndex),
    };

    if (removedStep) {
      setStepParameterText((currentText) => {
        const nextText = { ...currentText };

        delete nextText[removedStep.id];
        return nextText;
      });
      setStepParameterErrors((currentErrors) => {
        const nextErrors = { ...currentErrors };

        delete nextErrors[removedStep.id];
        return nextErrors;
      });
    }

    setSelectedWorkflowStepIndex((currentIndex) => {
      if (nextWorkflow.steps.length === 0) {
        return 0;
      }

      return Math.min(currentIndex, nextWorkflow.steps.length - 1);
    });
    updateWorkflowEditor(nextWorkflow);
  }

  function moveWorkflowStep(stepIndex: number, direction: -1 | 1) {
    if (!editorWorkflow) {
      return;
    }

    const targetIndex = stepIndex + direction;

    if (targetIndex < 0 || targetIndex >= editorWorkflow.steps.length) {
      return;
    }

    const nextSteps = [...editorWorkflow.steps];
    const currentStep = nextSteps[stepIndex];
    const targetStep = nextSteps[targetIndex];

    if (!currentStep || !targetStep) {
      return;
    }

    nextSteps[stepIndex] = targetStep;
    nextSteps[targetIndex] = currentStep;
    setSelectedWorkflowStepIndex(targetIndex);
    updateWorkflowEditor({
      ...editorWorkflow,
      steps: nextSteps,
    });
  }

  function updateStepParameters(stepIndex: number, nextText: string) {
    if (!editorWorkflow) {
      return;
    }

    const step = editorWorkflow.steps[stepIndex];

    if (!step) {
      return;
    }

    setStepParameterText((currentText) => ({
      ...currentText,
      [step.id]: nextText,
    }));

    let parsedValue: unknown;

    try {
      parsedValue = JSON.parse(nextText);
    } catch {
      setStepParameterErrors((currentErrors) => ({
        ...currentErrors,
        [step.id]: "Parameters must be valid JSON.",
      }));
      return;
    }

    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      setStepParameterErrors((currentErrors) => ({
        ...currentErrors,
        [step.id]: "Parameters must be a JSON object.",
      }));
      return;
    }

    setStepParameterErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };

      delete nextErrors[step.id];
      return nextErrors;
    });
    updateWorkflowStep(stepIndex, (currentStep) => ({
      ...currentStep,
      parameters: parsedValue as Record<string, unknown>,
    }));
  }

  async function saveWorkflow() {
    if (!activeWorkflow || !editorWorkflow) {
      return;
    }

    const validation = validateWorkflowDefinitionDraft(editorWorkflow);

    if (!validation.valid || Object.keys(stepParameterErrors).length > 0) {
      setActiveWorkflow({
        ...activeWorkflow,
        validationMessages: validation.messages,
      });
      return;
    }

    setIsSavingWorkflow(true);
    setErrorMessage("");

    try {
      const savedWorkflow = await saveCustomWorkflowAction(editorWorkflow);

      setWorkflowDefinitions((currentDefinitions) => [
        ...currentDefinitions.filter((workflow) => workflow.id !== savedWorkflow.id),
        {
          ...savedWorkflow,
          isBuiltIn: false,
          source: "custom",
        },
      ]);
      setActiveWorkflow({
        ...activeWorkflow,
        activeStepId: "save-workflow",
        builderState: {
          ...activeWorkflow.builderState,
          approvedWorkflowDefinition: savedWorkflow,
          draftWorkflowDefinition: savedWorkflow,
          status: "saved",
        },
        completed: true,
        draftWorkflow: savedWorkflow,
        savedWorkflow,
        validationMessages: [],
      });
      setMessages((currentMessages) => [
        ...currentMessages,
        createWorkflowMessage(
          `Saved "${savedWorkflow.name}" to the workflow catalog.`,
        ),
      ]);
      window.setTimeout(() => {
        setActiveWorkflow(null);
        setEditorWorkflow(null);
        setStepParameterErrors({});
        setStepParameterText({});
        setSelectedWorkflowStepIndex(0);
      }, 2500);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not save the workflow.",
      );
    } finally {
      setIsSavingWorkflow(false);
    }
  }

  function editWorkflow(workflow: WorkflowCatalogItem) {
    setOpenWorkflowMenuId(null);
    router.push(`/app/workflows/${workflow.id}/edit`);
  }

  async function duplicateWorkflowFromMenu(workflow: WorkflowCatalogItem) {
    const actionId = `duplicate:${workflow.id}`;

    setOpenWorkflowMenuId(null);
    setPendingWorkflowAction(actionId);
    setWorkflowActionError("");

    try {
      const duplicatedWorkflow = await duplicateWorkflowAction(workflow.id);

      setWorkflowDefinitions((currentDefinitions) => [
        ...currentDefinitions,
        duplicatedWorkflow,
      ]);
    } catch (error) {
      setWorkflowActionError(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not duplicate the workflow.",
      );
    } finally {
      setPendingWorkflowAction(null);
    }
  }

  async function confirmDeleteWorkflow() {
    if (!deleteCandidateWorkflow) {
      return;
    }

    if (deleteCandidateWorkflow.isBuiltIn) {
      throw new Error("Built-in workflows cannot be deleted.");
    }

    const workflowId = deleteCandidateWorkflow.id;

    setPendingWorkflowAction(`delete:${workflowId}`);
    setWorkflowActionError("");

    try {
      await deleteWorkflowAction(workflowId);
      setWorkflowDefinitions((currentDefinitions) =>
        currentDefinitions.filter((workflow) => workflow.id !== workflowId),
      );
      setActiveWorkflow((currentWorkflow) =>
        currentWorkflow?.workflowDefinition.id === workflowId
          ? null
          : currentWorkflow,
      );
      setDeleteCandidateWorkflow(null);
    } catch (error) {
      setWorkflowActionError(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not delete the workflow.",
      );
    } finally {
      setPendingWorkflowAction(null);
    }
  }

  function completeFileSelectorStep(output: FileSelectorStepOutput) {
    if (!activeWorkflow || !activeWorkflowStep) {
      throw new Error("Completing a file selector step requires an active workflow step.");
    }

    const currentStepIndex = activeWorkflow.workflowDefinition.steps.findIndex(
      (step) => step.id === activeWorkflowStep.id,
    );
    const nextStep = activeWorkflow.workflowDefinition.steps[currentStepIndex + 1];
    const nextStepOutputs = {
      ...activeWorkflow.stepOutputs,
      [activeWorkflowStep.id]: output,
    };

    setActiveWorkflow({
      ...activeWorkflow,
      activeStepId: nextStep?.id ?? activeWorkflow.activeStepId,
      completed: !nextStep,
      stepOutputs: nextStepOutputs,
    });
    setMessages((currentMessages) => [
      ...currentMessages,
      createWorkflowMessage(
        nextStep
          ? `Selected ${output.selectedMatterDocumentIds.length} source document${output.selectedMatterDocumentIds.length === 1 ? "" : "s"}. Next step: ${nextStep.name}.`
          : `Selected ${output.selectedMatterDocumentIds.length} source document${output.selectedMatterDocumentIds.length === 1 ? "" : "s"}. Workflow complete.`,
      ),
    ]);
  }

  function completeExtractionStep(output: ExtractionStepOutput) {
    if (!activeWorkflow || !activeWorkflowStep) {
      throw new Error("Completing an extraction step requires an active workflow step.");
    }

    const currentStepIndex = activeWorkflow.workflowDefinition.steps.findIndex(
      (step) => step.id === activeWorkflowStep.id,
    );
    const nextStep = activeWorkflow.workflowDefinition.steps[currentStepIndex + 1];
    const nextStepOutputs = {
      ...activeWorkflow.stepOutputs,
      [activeWorkflowStep.id]: output,
    };

    setActiveWorkflow({
      ...activeWorkflow,
      activeStepId: nextStep?.id ?? activeWorkflow.activeStepId,
      completed: !nextStep,
      stepOutputs: nextStepOutputs,
    });
    setMessages((currentMessages) => [
      ...currentMessages,
      createWorkflowMessage(
        nextStep
          ? `Prepared ${output.readyRepresentationCount} source document${output.readyRepresentationCount === 1 ? "" : "s"}. Next step: ${nextStep.name}.`
          : `Prepared ${output.readyRepresentationCount} source document${output.readyRepresentationCount === 1 ? "" : "s"}. Workflow complete.`,
      ),
    ]);
  }

  function returnToWorkflowStep(stepId: string) {
    if (!activeWorkflow) {
      throw new Error("Returning to a workflow step requires an active workflow.");
    }

    const targetStep = activeWorkflow.workflowDefinition.steps.find(
      (step) => step.id === stepId,
    );

    if (!targetStep) {
      throw new Error(`Workflow step was not found: ${stepId}`);
    }

    setActiveWorkflow({
      ...activeWorkflow,
      activeStepId: targetStep.id,
      completed: false,
    });
  }

  function completeDocumentEditorStep(output: DocumentEditorStepOutput) {
    if (!activeWorkflow || !activeWorkflowStep) {
      throw new Error("Completing a document editor step requires an active workflow step.");
    }

    const currentStepIndex = activeWorkflow.workflowDefinition.steps.findIndex(
      (step) => step.id === activeWorkflowStep.id,
    );
    const nextStep = activeWorkflow.workflowDefinition.steps[currentStepIndex + 1];
    const nextStepOutputs = {
      ...activeWorkflow.stepOutputs,
      [activeWorkflowStep.id]: output,
    };

    setActiveWorkflow({
      ...activeWorkflow,
      activeStepId: nextStep?.id ?? activeWorkflow.activeStepId,
      completed: !nextStep,
      stepOutputs: nextStepOutputs,
    });
    setMessages((currentMessages) => [
      ...currentMessages,
      createWorkflowMessage(
        nextStep
          ? `Reviewed document saved. Next step: ${nextStep.name}.`
          : "Reviewed document saved. Workflow complete.",
      ),
    ]);
  }

  async function submitMessage(messageOverride?: string) {
    const content = (messageOverride ?? draftMessage).trim();

    if (!content || isPending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content,
    };
    const assistantMessage: ChatMessage = {
      id: createMessageId(),
      role: "assistant",
      content: "",
    };
    const nextMessages = [...messages, userMessage];
    const abortController = new AbortController();

    abortControllerRef.current?.abort();
    abortControllerRef.current = abortController;
    setMessages([...nextMessages, assistantMessage]);
    setDraftMessage("");
    setErrorMessage("");
    setIsPending(true);

    try {
      const response = await fetch("/api/ai/chat", {
        body: JSON.stringify({
          matterId,
          messages: nextMessages
            .filter((message) => message.content.trim().length > 0)
            .map(({ content: messageContent, role }) => ({
              content: messageContent,
              role,
            })),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => null);

        if (isChatErrorResponse(errorBody)) {
          if (errorBody.redirectTo) {
            window.location.assign(errorBody.redirectTo);
            return;
          }

          throw new Error(errorBody.error);
        }

        throw new Error("AI chat request failed.");
      }

      await handleChatStream(response, assistantMessage.id);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not generate a response. Try again.",
      );
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        setIsPending(false);
      }
    }
  }

  const activeWorkflowStep = activeWorkflow?.workflowDefinition.steps.find(
    (step) => step.id === activeWorkflow.activeStepId,
  );
  const workflowCatalog = workflowDefinitions;
  const editorValidation = editorWorkflow
    ? validateWorkflowDefinitionDraft(editorWorkflow)
    : null;
  const editorParameterErrorMessages = Object.values(stepParameterErrors);
  const canSaveEditorWorkflow =
    Boolean(editorWorkflow) &&
    Boolean(editorValidation?.valid) &&
    editorParameterErrorMessages.length === 0;
  const isWorkflowBuilderActive =
    activeWorkflow?.workflowDefinition.id === "workflow-builder";
  const previewWorkflow =
    activeWorkflow?.savedWorkflow ||
    editorWorkflow ||
    activeWorkflow?.draftWorkflow ||
    activeWorkflow?.builderState.draftWorkflowDefinition ||
    null;
  const previewValidation = previewWorkflow
    ? validateWorkflowDefinitionDraft(previewWorkflow)
    : null;
  const previewValidationMessages = previewWorkflow
    ? [...(previewValidation?.messages ?? []), ...editorParameterErrorMessages]
    : [];
  const selectedWorkflowStep = editorWorkflow?.steps[selectedWorkflowStepIndex] || null;

  return (
    <section
      className="fixed inset-0 z-0 flex h-[100dvh] flex-col overflow-hidden bg-[#F7F6FA] text-[#211B27]"
      data-testid="matter-chat"
    >
      <header
        className="border-b border-[#312342] bg-[#42305B]"
        data-testid="matter-workspace-header"
      >
        <AppContainer className="flex h-14 items-center justify-between gap-4">
          <Link
            className="shrink-0 text-sm font-semibold tracking-[0.01em] text-white"
            href="/app/matters"
          >
            Matter Layer
          </Link>
          <div className="flex items-center gap-1">
            {isAdmin ? (
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] hover:bg-white/10 hover:text-white"
                data-testid="nav-admin"
                href="/app/admin"
              >
                Admin
              </Link>
            ) : null}
            <Link
              className="rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] hover:bg-white/10 hover:text-white"
              data-testid="nav-settings"
              href="/app/settings"
            >
              Settings
            </Link>
            <SignOutButton />
          </div>
        </AppContainer>
      </header>

      <nav
        aria-label="Breadcrumb"
        className="border-b border-[#E3DEEA] bg-white"
        data-testid="matter-breadcrumb"
      >
        <AppContainer>
          <ol className="flex h-10 items-center gap-2 text-sm">
            <li>
              <Link
                className="font-medium text-[#5F4B76] hover:text-[#42305B]"
                data-testid="breadcrumb-home"
                href="/app/matters"
              >
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-[#A79AB4]">
              /
            </li>
            <li
              aria-current="page"
              className="truncate font-semibold text-[#211B27]"
              data-testid="breadcrumb-current-matter"
            >
              {matterName}
            </li>
          </ol>
        </AppContainer>
      </nav>

      <nav
        aria-label="Matter navigation"
        className="border-b border-[#E3DEEA] bg-white"
        data-testid="matter-tabs"
      >
        <AppContainer className="flex h-11 items-center">
          {(["Chat", "Workflows", "Documents"] satisfies MatterTab[]).map((tab, index) => (
            <button
              aria-current={tab === selectedTab ? "page" : undefined}
              className={
                tab === selectedTab
                  ? "h-11 border-b-2 border-[#5F4B76] pr-4 text-sm font-semibold text-[#4B3861]"
                  : `h-11 text-sm font-medium text-[#74677F] transition-colors hover:text-[#211B27] ${
                      index === 0 ? "pr-4" : "px-4"
                    }`
              }
              data-testid={`matter-tab-${tab.toLowerCase()}`}
              key={tab}
              onClick={() => setSelectedTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </AppContainer>
      </nav>

      <AppContainer className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 py-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] border border-[#E3DEEA] bg-white shadow-[0_1px_2px_rgba(40,29,52,0.05)]"
          data-testid="chat-workspace-panel"
        >
          <div className="relative min-h-0 flex-1">
            <div
              className="h-full overflow-y-auto px-5 py-5"
              data-testid="chat-scroll-container"
              onScroll={updateNearBottom}
              ref={scrollContainerRef}
            >
              <div
                className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4"
                data-testid="conversation-area"
              >
                {selectedTab === "Workflows" && !activeWorkflow ? (
                  <div
                    className="flex min-h-full flex-col gap-5"
                    data-testid="available-workflows-panel"
                  >
                    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E3DEEA] pb-4">
                      <div>
                        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
                          {matterName}
                        </p>
                        <h1 className="mt-2 text-2xl font-semibold text-[#211B27]">
                          Available workflows
                        </h1>
                      </div>
                      <p className="max-w-sm text-sm leading-6 text-[#74677F]">
                        Start a guided process for this matter. The canvas tracks
                        the active workflow once one is selected.
                      </p>
                    </div>

                    {workflowActionError ? (
                      <p
                        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
                        data-testid="workflow-action-error"
                        role="alert"
                      >
                        {workflowActionError}
                      </p>
                    ) : null}

                    <div
                      className="grid gap-3"
                      ref={workflowMenuContainerRef}
                    >
                      {workflowCatalog.map((workflow) => (
                        <article
                          className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4 shadow-[0_1px_2px_rgba(40,29,52,0.04)]"
                          data-testid={`available-workflow-card-${workflow.id}`}
                          key={workflow.id}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <h2 className="text-base font-semibold text-[#211B27]">
                                {workflow.name}
                              </h2>
                              {workflow.description ? (
                                <p className="mt-2 text-sm leading-6 text-[#74677F]">
                                  {workflow.description}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861]"
                                data-testid={`workflow-chip-${workflow.id}`}
                                onClick={() => startWorkflow(workflow)}
                                type="button"
                              >
                                Start workflow
                              </button>
                              <div className="relative">
                                <button
                                  aria-expanded={
                                    openWorkflowMenuId === workflow.id
                                      ? "true"
                                      : "false"
                                  }
                                  aria-haspopup="menu"
                                  aria-label={`Workflow actions for ${workflow.name}`}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC]"
                                  data-testid={`workflow-overflow-${workflow.id}`}
                                  onClick={() =>
                                    setOpenWorkflowMenuId((currentMenuId) =>
                                      currentMenuId === workflow.id ? null : workflow.id,
                                    )
                                  }
                                  type="button"
                                >
                                  ...
                                </button>
                                {openWorkflowMenuId === workflow.id ? (
                                  <div
                                    className="absolute right-0 top-11 z-20 w-44 rounded-lg border border-[#E3DEEA] bg-white py-1 shadow-[0_12px_32px_rgba(40,29,52,0.16)]"
                                    data-testid={`workflow-menu-${workflow.id}`}
                                    role="menu"
                                  >
                                    <button
                                      className="block w-full px-3 py-2 text-left text-sm font-medium text-[#211B27] hover:bg-[#FBFAFC]"
                                      data-testid={`workflow-menu-edit-${workflow.id}`}
                                      onClick={() => editWorkflow(workflow)}
                                      role="menuitem"
                                      type="button"
                                    >
                                      Edit workflow
                                    </button>
                                    <button
                                      className="block w-full px-3 py-2 text-left text-sm font-medium text-[#211B27] hover:bg-[#FBFAFC] disabled:cursor-not-allowed disabled:text-[#A79AB4]"
                                      data-testid={`workflow-menu-duplicate-${workflow.id}`}
                                      disabled={
                                        pendingWorkflowAction ===
                                        `duplicate:${workflow.id}`
                                      }
                                      onClick={() => {
                                        void duplicateWorkflowFromMenu(workflow);
                                      }}
                                      role="menuitem"
                                      type="button"
                                    >
                                      Duplicate workflow
                                    </button>
                                    {!workflow.isBuiltIn ? (
                                      <button
                                        className="block w-full px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
                                        data-testid={`workflow-menu-delete-${workflow.id}`}
                                        onClick={() => {
                                          setOpenWorkflowMenuId(null);
                                          setDeleteCandidateWorkflow(workflow);
                                        }}
                                        role="menuitem"
                                        type="button"
                                      >
                                        Delete workflow
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : selectedTab === "Workflows" && isWorkflowBuilderActive ? (
                  <div
                    className="grid gap-5"
                    data-testid="workflow-builder-interaction"
                  >
                    <div>
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
                        Active Workflow
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-[#211B27]">
                        Workflow Builder
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-[#74677F]">
                        Current step: {activeWorkflowStep?.name}
                      </p>
                    </div>

                    {activeWorkflow?.activeStepId === "define-goal" ? (
                      <section
                        className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4"
                        data-testid="workflow-define-goal-panel"
                      >
                        <h3 className="text-base font-semibold text-[#211B27]">
                          Define Goal
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#74677F]">
                          Describe the business outcome this workflow should accomplish.
                        </p>
                        <form
                          className="mt-4 grid gap-3"
                          data-testid="workflow-goal-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            submitWorkflowGoal();
                          }}
                        >
                          <label
                            className="text-sm font-semibold text-[#211B27]"
                            htmlFor="workflow-goal"
                          >
                            Workflow goal
                          </label>
                          <textarea
                            className="min-h-32 resize-none rounded-lg border border-[#CFC5DA] bg-white px-3 py-2 text-sm leading-6 text-[#211B27] outline-none focus:border-[#5F4B76]"
                            data-testid="workflow-goal-input"
                            id="workflow-goal"
                            onChange={(event) => setWorkflowGoalInput(event.target.value)}
                            placeholder="Draft an Original Petition for Divorce"
                            value={workflowGoalInput}
                          />
                          <button
                            className="inline-flex h-9 items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]"
                            data-testid="workflow-goal-submit"
                            disabled={!workflowGoalInput.trim()}
                            type="submit"
                          >
                            Generate Draft Workflow
                          </button>
                        </form>
                        <div className="mt-4 rounded-lg border border-[#E3DEEA] bg-white p-3">
                          <p className="text-sm font-semibold text-[#211B27]">
                            Example goals
                          </p>
                          <ul className="mt-2 grid gap-1 text-sm leading-5 text-[#74677F]">
                            <li>Update clients on the current state of their matter.</li>
                            <li>Create a chronology from selected matter files.</li>
                            <li>Generate a document from structured intake answers.</li>
                          </ul>
                        </div>
                      </section>
                    ) : null}

                    {activeWorkflow?.activeStepId === "generate-draft" ? (
                      <section
                        className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4"
                        data-testid="workflow-generate-draft-panel"
                      >
                        <h3 className="text-base font-semibold text-[#211B27]">
                          Generate Draft Workflow
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#74677F]">
                          Generating draft workflow...
                        </p>
                        <p className="mt-2 rounded-lg border border-[#E3DEEA] bg-white p-3 text-sm leading-6 text-[#4B3861]">
                          Goal: {activeWorkflow.builderState.goal}
                        </p>
                      </section>
                    ) : null}

                    {activeWorkflow?.activeStepId === "edit-workflow" && editorWorkflow ? (
                      <section
                        className="grid gap-5"
                        data-testid="workflow-editor-panel"
                      >
                        <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
                          <h3 className="text-base font-semibold text-[#211B27]">
                            Workflow Details
                          </h3>
                          <label className="mt-4 block text-sm font-semibold text-[#211B27]">
                            Workflow name
                            <input
                              className="mt-2 w-full rounded-lg border border-[#CFC5DA] bg-white px-3 py-2 text-sm text-[#211B27] outline-none focus:border-[#5F4B76]"
                              data-testid="workflow-name-input"
                              onChange={(event) =>
                                updateWorkflowEditor({
                                  ...editorWorkflow,
                                  name: event.target.value,
                                })
                              }
                              value={editorWorkflow.name}
                            />
                          </label>
                          <label className="mt-4 block text-sm font-semibold text-[#211B27]">
                            Workflow description
                            <textarea
                              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-[#CFC5DA] bg-white px-3 py-2 text-sm leading-6 text-[#211B27] outline-none focus:border-[#5F4B76]"
                              data-testid="workflow-description-input"
                              onChange={(event) =>
                                updateWorkflowEditor({
                                  ...editorWorkflow,
                                  description: event.target.value,
                                })
                              }
                              value={editorWorkflow.description}
                            />
                          </label>
                        </div>

                        <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
                          <h3 className="text-base font-semibold text-[#211B27]">
                            Step Catalog
                          </h3>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {WORKFLOW_EDITOR_STEP_TYPES.map((type) => {
                              if (!isWorkflowStepType(type)) {
                                throw new Error(`Unsupported workflow editor step type: ${type}`);
                              }

                              const registration = workflowStepRegistry[type];

                              return (
                                <button
                                  className="rounded-lg border border-[#E3DEEA] bg-white p-2 text-left transition-colors hover:border-[#CFC5DA] hover:bg-[#FBFAFC]"
                                  data-testid={`workflow-add-step-${type}`}
                                  key={type}
                                  onClick={() => addWorkflowStep(type)}
                                  type="button"
                                >
                                  <span className="block text-sm font-semibold text-[#211B27]">
                                    {registration.displayName}
                                  </span>
                                  <span className="mt-1 block text-xs leading-5 text-[#74677F]">
                                    {registration.description}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
                          <h3 className="text-base font-semibold text-[#211B27]">
                            Workflow Steps
                          </h3>
                          {editorWorkflow.steps.length ? (
                            <div className="mt-3 grid gap-2">
                              {editorWorkflow.steps.map((step, index) => (
                                <button
                                  className={
                                    index === selectedWorkflowStepIndex
                                      ? "rounded-lg border border-[#5F4B76] bg-white p-3 text-left shadow-[0_1px_2px_rgba(40,29,52,0.08)]"
                                      : "rounded-lg border border-[#E3DEEA] bg-white p-3 text-left transition-colors hover:border-[#CFC5DA]"
                                  }
                                  data-testid="workflow-step-select"
                                  key={step.id}
                                  onClick={() => setSelectedWorkflowStepIndex(index)}
                                  type="button"
                                >
                                  <span className="block text-sm font-semibold text-[#211B27]">
                                    {index + 1}. {step.name || "Unnamed step"}
                                  </span>
                                  <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[#74677F]">
                                    {isWorkflowStepType(step.type)
                                      ? workflowStepRegistry[step.type].displayName
                                      : step.type}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 rounded-lg border border-[#E3DEEA] bg-white p-3 text-sm leading-6 text-[#74677F]">
                              No workflow steps yet.
                            </p>
                          )}
                        </div>

                        {selectedWorkflowStep ? (
                          <div
                            className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4"
                            data-testid="workflow-step-editor"
                          >
                            <h3 className="text-base font-semibold text-[#211B27]">
                              Step Parameters
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-[#74677F]">
                              Editing step {selectedWorkflowStepIndex + 1}: {selectedWorkflowStep.type}
                            </p>
                            <label className="mt-4 block text-sm font-semibold text-[#211B27]">
                              Step name
                              <input
                                className="mt-2 w-full rounded-lg border border-[#CFC5DA] bg-white px-3 py-2 text-sm text-[#211B27] outline-none focus:border-[#5F4B76]"
                                data-testid="workflow-step-name-input"
                                onChange={(event) =>
                                  updateWorkflowStep(
                                    selectedWorkflowStepIndex,
                                    (currentStep) => ({
                                      ...currentStep,
                                      name: event.target.value,
                                    }),
                                  )
                                }
                                value={selectedWorkflowStep.name}
                              />
                            </label>
                            <label className="mt-4 block text-sm font-semibold text-[#211B27]">
                              Step description
                              <textarea
                                className="mt-2 min-h-24 w-full resize-none rounded-lg border border-[#CFC5DA] bg-white px-3 py-2 text-sm leading-6 text-[#211B27] outline-none focus:border-[#5F4B76]"
                                data-testid="workflow-step-description-input"
                                onChange={(event) =>
                                  updateWorkflowStep(
                                    selectedWorkflowStepIndex,
                                    (currentStep) => ({
                                      ...currentStep,
                                      description: event.target.value,
                                    }),
                                  )
                                }
                                value={selectedWorkflowStep.description || ""}
                              />
                            </label>
                            <label className="mt-4 block text-sm font-semibold text-[#211B27]">
                              Parameters JSON
                              <textarea
                                className="mt-2 min-h-32 w-full resize-none rounded-lg border border-[#CFC5DA] bg-white px-3 py-2 font-mono text-xs leading-5 text-[#211B27] outline-none focus:border-[#5F4B76]"
                                data-testid="workflow-step-parameters-input"
                                onChange={(event) =>
                                  updateStepParameters(
                                    selectedWorkflowStepIndex,
                                    event.target.value,
                                  )
                                }
                                value={
                                  stepParameterText[selectedWorkflowStep.id] ??
                                  JSON.stringify(selectedWorkflowStep.parameters, null, 2)
                                }
                              />
                            </label>
                            {stepParameterErrors[selectedWorkflowStep.id] ? (
                              <p
                                className="mt-2 text-sm leading-5 text-red-700"
                                data-testid="workflow-step-parameter-error"
                              >
                                {stepParameterErrors[selectedWorkflowStep.id]}
                              </p>
                            ) : null}
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                className="rounded-md border border-[#CFC5DA] bg-white px-3 py-1.5 text-sm font-semibold text-[#4B3861] disabled:cursor-not-allowed disabled:opacity-50"
                                data-testid="workflow-step-move-up"
                                disabled={selectedWorkflowStepIndex === 0}
                                onClick={() => moveWorkflowStep(selectedWorkflowStepIndex, -1)}
                                type="button"
                              >
                                Move up
                              </button>
                              <button
                                className="rounded-md border border-[#CFC5DA] bg-white px-3 py-1.5 text-sm font-semibold text-[#4B3861] disabled:cursor-not-allowed disabled:opacity-50"
                                data-testid="workflow-step-move-down"
                                disabled={selectedWorkflowStepIndex === editorWorkflow.steps.length - 1}
                                onClick={() => moveWorkflowStep(selectedWorkflowStepIndex, 1)}
                                type="button"
                              >
                                Move down
                              </button>
                              <button
                                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700"
                                data-testid="workflow-step-remove"
                                onClick={() => removeWorkflowStep(selectedWorkflowStepIndex)}
                                type="button"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : null}

                        <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
                          {editorParameterErrorMessages.length ? (
                            <div
                              className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
                              data-testid="workflow-validation"
                            >
                              <p className="text-sm font-semibold text-amber-900">
                                Validation
                              </p>
                              <ul className="mt-2 grid gap-1 text-sm leading-5 text-amber-900">
                                {editorParameterErrorMessages.map((message) => (
                                  <li key={message}>{message}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          <button
                            className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]"
                            data-testid="workflow-save-button"
                            disabled={!canSaveEditorWorkflow || isSavingWorkflow}
                            onClick={saveWorkflow}
                            type="button"
                          >
                            {isSavingWorkflow ? "Saving..." : "Save Workflow"}
                          </button>
                        </div>
                      </section>
                    ) : null}

                    {activeWorkflow?.activeStepId === "save-workflow" ? (
                      <section
                        className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
                        data-testid="workflow-save-panel"
                      >
                        <h3 className="text-base font-semibold text-emerald-900">
                          Workflow saved
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-emerald-900">
                          {activeWorkflow.savedWorkflow?.name ||
                            activeWorkflow.builderState.draftWorkflowDefinition?.name} is available in the workflow catalog.
                        </p>
                      </section>
                    ) : null}
                  </div>
                ) : selectedTab === "Workflows" &&
                  activeWorkflow &&
                  activeWorkflowStep?.type === "fileSelector" ? (
                  <FileSelectorStepComponent
                    loadStepState={loadFileSelectorStepStateAction}
                    matterId={matterId}
                    onComplete={completeFileSelectorStep}
                    saveSelection={saveFileSelectorSelectionAction}
                    step={activeWorkflowStep}
                    uploadFiles={uploadFileSelectorFilesAction}
                    workflowDefinitionId={activeWorkflow.workflowDefinition.id}
                    workflowRunId={activeWorkflow.workflowRunId}
                  />
                ) : selectedTab === "Workflows" &&
                  activeWorkflow &&
                  activeWorkflowStep?.type === "extraction" ? (
                  <ExtractionStepComponent
                    loadStepState={loadExtractionStepStateAction}
                    matterId={matterId}
                    onComplete={completeExtractionStep}
                    onReturnToInputStep={returnToWorkflowStep}
                    runStep={runExtractionStepAction}
                    step={activeWorkflowStep}
                    workflowDefinitionId={activeWorkflow.workflowDefinition.id}
                    workflowRunId={activeWorkflow.workflowRunId}
                  />
                ) : selectedTab === "Workflows" &&
                  activeWorkflow &&
                  activeWorkflowStep?.type === "documentEditor" ? (
                  <DocumentEditorStepComponent
                    loadStepState={loadDocumentEditorStepStateAction}
                    matterId={matterId}
                    onComplete={completeDocumentEditorStep}
                    saveArtifact={saveDocumentEditorArtifactAction}
                    step={activeWorkflowStep}
                    workflowDefinitionId={activeWorkflow.workflowDefinition.id}
                    workflowRunId={activeWorkflow.workflowRunId}
                  />
                ) : selectedTab === "Workflows" && activeWorkflow ? (
                  <div
                    className="grid gap-5"
                    data-testid="workflow-active-summary"
                  >
                    <div>
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
                        Active Workflow
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-[#211B27]">
                        {activeWorkflow.workflowDefinition.name}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-[#74677F]">
                        Current step: {activeWorkflowStep?.name}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
                      <h3 className="text-base font-semibold text-[#211B27]">
                        Workflow steps
                      </h3>
                      <ol className="mt-3 grid gap-2">
                        {activeWorkflow.workflowDefinition.steps.map((step, index) => (
                          <li
                            className={
                              step.id === activeWorkflow.activeStepId
                                ? "rounded-lg border border-[#5F4B76] bg-white p-3"
                                : "rounded-lg border border-[#E3DEEA] bg-white p-3"
                            }
                            key={step.id}
                          >
                            <p className="text-sm font-semibold text-[#211B27]">
                              {index + 1}. {step.name}
                            </p>
                            {step.description ? (
                              <p className="mt-1 text-sm leading-5 text-[#74677F]">
                                {step.description}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ) : selectedTab === "Chat" && messages.length === 0 && !isPending ? (
                  <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-3">
                    <div className="grid gap-3 lg:grid-cols-3">
                      {actionCards.map((card) => (
                        <button
                          className="rounded-lg border border-[#E3DEEA] bg-white p-3 text-left transition-colors hover:border-[#CFC5DA] hover:bg-[#FBFAFC]"
                          key={card.title}
                          onClick={
                            card.title === "Start a workflow"
                              ? startWorkflowBuilder
                              : undefined
                          }
                          type="button"
                        >
                          <span className="block text-sm font-semibold text-[#211B27]">
                            {card.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedTab === "Documents" ? (
                  <div
                    className="flex min-h-full items-center justify-center rounded-xl border border-dashed border-[#CFC5DA] bg-[#FBFAFC] p-6 text-center"
                    data-testid="documents-empty-state"
                  >
                    <div>
                      <h2 className="text-base font-semibold text-[#211B27]">
                        Documents
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[#74677F]">
                        Matter documents will appear here.
                      </p>
                    </div>
                  </div>
                ) : null}

                {selectedTab === "Chat" ? messages.map((chatMessage) => (
                  <article
                    className={
                      chatMessage.role === "user"
                        ? "ml-auto max-w-[78%] rounded-xl rounded-br-md bg-[#4B3861] px-4 py-3 text-sm leading-6 text-white"
                        : "mr-auto max-w-[78%] rounded-xl rounded-bl-md border border-[#E3DEEA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#211B27]"
                    }
                    data-testid={`chat-message-${chatMessage.role}`}
                    key={chatMessage.id}
                  >
                  <p className="min-h-6 whitespace-pre-wrap">
                    {chatMessage.content}
                  </p>
                </article>
              )) : null}

                {selectedTab === "Chat" && errorMessage ? (
                  <p
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
                    data-testid="chat-error"
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                ) : null}
              </div>
            </div>

            {showJumpToLatest ? (
              <button
                className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[#CFC5DA] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B3861] shadow-[0_8px_24px_rgba(40,29,52,0.16)] transition-colors hover:bg-[#FBFAFC]"
                data-testid="jump-to-latest-button"
                onClick={() => scrollToBottom()}
                type="button"
              >
                Jump to latest
              </button>
            ) : null}
          </div>

          {selectedTab === "Chat" ? (
          <div className="shrink-0 border-t border-[#E3DEEA] bg-[#FBFAFC] px-5 py-4">
            <form
              className="mx-auto max-w-3xl rounded-xl border border-[#CFC5DA] bg-white p-3 shadow-[0_1px_2px_rgba(40,29,52,0.05)]"
              data-testid="message-composer"
              onSubmit={async (event) => {
                event.preventDefault();
                await submitMessage();
              }}
            >
              <label className="sr-only" htmlFor="matter-message">
                Message Matter Layer
              </label>
              <textarea
                className="max-h-64 min-h-[8.75rem] w-full resize-none overflow-y-auto rounded-lg border-0 bg-transparent px-1 py-1 text-sm leading-6 text-[#211B27] outline-none placeholder:text-[#74677F]"
                data-testid="message-textarea"
                disabled={isPending}
                id="matter-message"
                name="message"
                onChange={(event) => setDraftMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                placeholder="Message Matter Layer..."
                ref={composerTextareaRef}
                rows={6}
                value={draftMessage}
              />
              <div className="mt-3 flex justify-end">
                {isPending ? (
                  <button
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC]"
                    data-testid="stop-streaming-button"
                    onClick={stopStreaming}
                    type="button"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]"
                    data-testid="send-message-button"
                    disabled={!draftMessage.trim()}
                    type="submit"
                  >
                    Send
                  </button>
                )}
              </div>
            </form>
          </div>
          ) : null}
        </section>

        <aside
          className="h-full min-h-0 overflow-y-auto rounded-[14px] border border-[#E3DEEA] bg-white p-4 shadow-[0_1px_2px_rgba(40,29,52,0.05)]"
          data-testid="matter-context-panel"
        >
          {!activeWorkflow ? (
            <div data-testid="available-workflows-canvas">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
                Canvas
              </p>
              <h2 className="mt-2 text-base font-semibold text-[#211B27]">
                {matterName}
              </h2>
              <div className="mt-4 rounded-lg border border-dashed border-[#CFC5DA] bg-[#FBFAFC] p-4">
                <p className="text-sm font-semibold text-[#211B27]">
                  Select a workflow to begin.
                </p>
                <p className="mt-2 text-sm leading-6 text-[#74677F]">
                  Workflow status and work product will appear here after a
                  workflow starts.
                </p>
              </div>
            </div>
          ) : (
            <div data-testid="active-workflow-canvas">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
                Active Workflow
              </p>
              <h2 className="mt-2 text-base font-semibold text-[#211B27]">
                {activeWorkflow.workflowDefinition.name}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#74677F]">
                Current step: {activeWorkflowStep?.name}
              </p>

              <div className="mt-4 border-t border-[#E3DEEA] pt-4">
                <p className="text-sm font-semibold text-[#211B27]">
                  Work Product Canvas
                </p>
                {activeWorkflow.workflowDefinition.id === "workflow-builder" ? (
                  <div className="mt-3" data-testid="workflow-builder-canvas">
                    {!previewWorkflow ? (
                      <div
                        className="rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] p-4"
                        data-testid="workflow-preview-empty"
                      >
                        <h3 className="text-base font-semibold text-[#211B27]">
                          Workflow preview
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#74677F]">
                          {activeWorkflow.activeStepId === "generate-draft"
                            ? "Generating draft workflow..."
                            : "No workflow drafted yet"}
                        </p>
                      </div>
                    ) : (
                      <div data-testid="workflow-preview-outline">
                        <p className="text-sm font-semibold text-[#211B27]">
                          Workflow being created
                        </p>
                        <h3 className="mt-2 text-lg font-semibold text-[#211B27]">
                          {previewWorkflow.name || "Untitled workflow"}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#74677F]">
                          {previewWorkflow.description || "No description yet."}
                        </p>

                        <div className="mt-5">
                          <p className="text-sm font-semibold text-[#211B27]">
                            Steps
                          </p>
                          {previewWorkflow.steps.length ? (
                            <ol className="mt-3 grid gap-3">
                              {previewWorkflow.steps.map((step, index) => (
                                <li
                                  className="rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] p-3"
                                  data-testid="workflow-draft-step"
                                  key={step.id}
                                >
                                  <div className="flex items-start gap-2">
                                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5F4B76] text-xs font-semibold text-white">
                                      {index + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-semibold text-[#211B27]">
                                        {isWorkflowStepType(step.type)
                                          ? workflowStepRegistry[step.type].displayName
                                          : step.type}
                                      </p>
                                      <p className="mt-1 text-sm font-semibold text-[#4B3861]">
                                        {step.name || "Unnamed step"}
                                      </p>
                                      <p className="mt-1 text-sm leading-5 text-[#74677F]">
                                        {step.description || "No description yet."}
                                      </p>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="mt-3 rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] p-3 text-sm leading-6 text-[#74677F]">
                              No workflow steps yet.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {previewValidationMessages.length ? (
                      <div
                        className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3"
                        data-testid="workflow-validation"
                      >
                        <p className="text-sm font-semibold text-amber-900">
                          Validation
                        </p>
                        <ul className="mt-2 grid gap-1 text-sm leading-5 text-amber-900">
                          {previewValidationMessages.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      </div>
                    ) : previewWorkflow ? (
                      <div
                        className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                        data-testid="workflow-validation"
                      >
                        <p className="text-sm font-semibold text-emerald-900">
                          Validation
                        </p>
                        <p className="mt-1 text-sm leading-5 text-emerald-900">
                          Workflow is valid.
                        </p>
                      </div>
                    ) : null}

                    {activeWorkflow.activeStepId === "save-workflow" ? (
                      <div
                        className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                        data-testid="workflow-save-confirmation"
                      >
                        <p className="text-sm font-semibold text-emerald-900">
                          Workflow saved
                        </p>
                        <p className="mt-1 text-sm leading-5 text-emerald-900">
                          {activeWorkflow.savedWorkflow?.name ||
                            activeWorkflow.builderState.draftWorkflowDefinition?.name} is available in the workflow catalog.
                        </p>
                        {activeWorkflow.savedWorkflow ? (
                          <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-2 text-sm font-semibold text-emerald-900">
                            Catalog: {activeWorkflow.savedWorkflow.name}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <ol className="mt-3 grid gap-3" data-testid="workflow-run-canvas">
                    {activeWorkflow.workflowDefinition.steps.map((step, index) => (
                      <li
                        className={
                          step.id === activeWorkflow.activeStepId
                            ? "rounded-lg border border-[#5F4B76] bg-[#FBFAFC] p-3"
                            : "rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] p-3"
                        }
                        key={step.id}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5F4B76] text-xs font-semibold text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[#211B27]">
                              {step.name}
                            </p>
                            {step.description ? (
                              <p className="mt-1 text-sm leading-5 text-[#74677F]">
                                {step.description}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </aside>
      </AppContainer>

      {deleteCandidateWorkflow ? (
        <div
          aria-labelledby="delete-workflow-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#211B27]/40 px-4"
          data-testid="delete-workflow-dialog"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-xl border border-[#E3DEEA] bg-white p-5 shadow-[0_24px_64px_rgba(40,29,52,0.24)]">
            <h2
              className="text-lg font-semibold text-[#211B27]"
              id="delete-workflow-title"
            >
              Delete {deleteCandidateWorkflow.name}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#74677F]">
              This workflow will be permanently deleted. This action cannot be
              undone.
            </p>
            {workflowActionError ? (
              <p
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-800"
                data-testid="delete-workflow-error"
                role="alert"
              >
                {workflowActionError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="inline-flex h-9 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC]"
                data-testid="cancel-delete-workflow"
                onClick={() => setDeleteCandidateWorkflow(null)}
                ref={deleteDialogCancelRef}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex h-9 items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300"
                data-testid="confirm-delete-workflow"
                disabled={
                  pendingWorkflowAction ===
                  `delete:${deleteCandidateWorkflow.id}`
                }
                onClick={() => {
                  void confirmDeleteWorkflow();
                }}
                type="button"
              >
                Delete workflow
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
