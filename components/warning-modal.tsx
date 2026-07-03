"use client";

import { useEffect, type ReactNode } from "react";

type WarningModalProps = {
  cancelLabel: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmTestId?: string;
  cancelTestId?: string;
  isPending?: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  testId?: string;
  title: string;
  variant?: "danger" | "warning";
};

export function WarningModal({
  cancelLabel,
  cancelTestId,
  children,
  confirmLabel,
  confirmTestId,
  isPending = false,
  message,
  onCancel,
  onConfirm,
  open,
  testId,
  title,
  variant = "warning",
}: WarningModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isPending, onCancel, open]);

  if (!open) {
    return null;
  }

  const confirmClass =
    variant === "danger"
      ? "inline-flex h-9 items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300"
      : "inline-flex h-9 items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]";

  return (
    <div
      aria-labelledby={testId ? `${testId}-title` : undefined}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#211B27]/40 px-4"
      data-testid={testId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onCancel();
        }
      }}
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-[#E3DEEA] bg-white p-5 shadow-[0_24px_64px_rgba(40,29,52,0.24)]">
        <h2
          className="text-lg font-semibold text-[#211B27]"
          id={testId ? `${testId}-title` : undefined}
        >
          {title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#74677F]">
          {message}
        </p>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="inline-flex h-9 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC] disabled:cursor-not-allowed disabled:opacity-60"
            data-testid={cancelTestId}
            disabled={isPending}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={confirmClass}
            data-testid={confirmTestId}
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
