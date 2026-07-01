import type { WorkflowStepError } from "./workflow-step-errors";

export type WorkflowStepProgressStatus =
  | "not_started"
  | "running"
  | "completed"
  | "failed"
  | "partial_failed";

export type WorkflowStepProgressItemStatus =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type WorkflowStepProgressItemPhase =
  | "queued"
  | "loading"
  | "converting"
  | "extracting"
  | "completed"
  | "failed";

export type WorkflowStepProgressItem = {
  error?: Pick<WorkflowStepError, "code" | "userMessage">;
  id: string;
  label: string;
  message?: string;
  phase?: WorkflowStepProgressItemPhase;
  percentComplete?: number;
  status: WorkflowStepProgressItemStatus;
};

export type WorkflowStepProgress = {
  activeItemId?: string;
  activeItemLabel?: string;
  activePhase?: WorkflowStepProgressItemPhase;
  completedItems?: number;
  currentItemId?: string;
  currentItemLabel?: string;
  currentItemMessage?: string;
  currentItemPhase?: WorkflowStepProgressItemPhase;
  items?: WorkflowStepProgressItem[];
  message?: string;
  percentComplete?: number;
  status: WorkflowStepProgressStatus;
  totalItems?: number;
};

export function progressPercent(completedItems: number, totalItems: number) {
  return progressPercentWithActiveItem({
    completedItems,
    totalItems,
  });
}

export function progressPercentWithActiveItem(input: {
  activeItemPercent?: number;
  completedItems: number;
  totalItems: number;
}) {
  if (input.totalItems <= 0) {
    return 0;
  }

  const activeItemFraction =
    typeof input.activeItemPercent === "number"
      ? Math.min(100, Math.max(0, input.activeItemPercent)) / 100
      : 0;
  const percent =
    ((input.completedItems + activeItemFraction) / input.totalItems) * 100;

  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function completedProgressItemCount(items: WorkflowStepProgressItem[]) {
  return items.filter(
    (item) =>
      item.status === "completed" ||
      item.status === "failed" ||
      item.status === "skipped",
  ).length;
}

export function activeProgressItem(items: WorkflowStepProgressItem[]) {
  return items.find((item) => item.status === "running") ?? null;
}

export function progressPercentFromItems(items: WorkflowStepProgressItem[]) {
  if (items.length <= 0) {
    return 0;
  }

  const activeItem = activeProgressItem(items);

  return progressPercentWithActiveItem({
    activeItemPercent: activeItem?.percentComplete,
    completedItems: completedProgressItemCount(items),
    totalItems: items.length,
  });
}
