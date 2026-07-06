"use client";

import { ReactNode, useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AppTabs } from "@/components/app-tabs";
import {
  AppMainPanel,
  AppSidePanel,
  AppWorkspaceLayout,
} from "@/components/app-workspace";
import { WarningModal } from "@/components/warning-modal";
import type { ResetApplicationActionState } from "./actions";

type AdminTab = "AI Providers" | "Workflows" | "Retention";

type AdminTabsProps = {
  aiProvidersPanel: ReactNode;
  initialTab?: AdminTab;
  resetApplicationAction: (
    previousState: ResetApplicationActionState,
    formData: FormData,
  ) => Promise<ResetApplicationActionState>;
  workflowsPanel: ReactNode;
};

const RESET_APPLICATION_CONFIRMATION_PHRASE = "RESET MATTER LAYER";

const ADMIN_TABS = [
  {
    label: "AI Providers",
    testId: "admin-tab-ai-providers",
    value: "AI Providers",
  },
  {
    label: "Workflows",
    testId: "admin-tab-workflows",
    value: "Workflows",
  },
  {
    label: "Retention",
    testId: "admin-tab-retention",
    value: "Retention",
  },
] as const;

export function AdminTabs({
  aiProvidersPanel,
  initialTab = "AI Providers",
  resetApplicationAction,
  workflowsPanel,
}: AdminTabsProps) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<AdminTab>(initialTab);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const resetApplicationFormRef = useRef<HTMLFormElement>(null);
  async function handleResetApplicationSubmit(
    previousState: ResetApplicationActionState,
    formData: FormData,
  ) {
    const nextState = await resetApplicationAction(previousState, formData);

    if (nextState.status === "success") {
      setIsResetDialogOpen(false);
      setConfirmationPhrase("");
      router.refresh();
    }

    return nextState;
  }

  const [resetApplicationState, submitResetApplication, isResetPending] =
    useActionState(handleResetApplicationSubmit, {
      message: "",
      status: "idle",
    } satisfies ResetApplicationActionState);
  const panelDescription = getPanelDescription(selectedTab);
  const canvasDescription = getCanvasDescription(selectedTab);
  const isConfirmationPhraseValid =
    confirmationPhrase === RESET_APPLICATION_CONFIRMATION_PHRASE;

  return (
    <div>
      <AppTabs
        ariaLabel="Admin navigation"
        onSelect={(tab) => {
          setSelectedTab(tab);

          if (tab === "Workflows") {
            router.push("/app/admin?tab=workflows");
          } else if (tab === "Retention") {
            router.push("/app/admin?tab=retention");
          }
        }}
        selectedTab={selectedTab}
        tabs={ADMIN_TABS}
        testId="admin-tabs"
      />

      <AppWorkspaceLayout
        className="mt-4"
        sidebar={
          <AppSidePanel testId="admin-side-panel">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
              Canvas
            </p>
            <h2 className="mt-2 text-base font-semibold text-[#211B27]">
              Admin
            </h2>
            <div className="mt-4 rounded-lg border border-dashed border-[#CFC5DA] bg-[#FBFAFC] p-4">
              <p className="text-sm font-semibold text-[#211B27]">
                {selectedTab}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#74677F]">
                {canvasDescription}
              </p>
            </div>
          </AppSidePanel>
        }
        testId="admin-workspace-layout"
      >
        <AppMainPanel className="p-5" testId="admin-main-panel">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E3DEEA] pb-4">
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
                Admin
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[#211B27]">
                {selectedTab}
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-[#74677F]">
              {panelDescription}
            </p>
          </div>

          <div className="pt-5">
            {selectedTab === "AI Providers" ? (
              <section data-testid="admin-ai-providers-panel">
                {aiProvidersPanel}
              </section>
            ) : selectedTab === "Workflows" ? (
              <section data-testid="admin-workflows-panel">
                {workflowsPanel}
              </section>
            ) : (
              <section data-testid="admin-retention-panel">
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <h3 className="text-base font-semibold text-red-950">
                    Retention
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-red-800">
                    This area controls destructive data-retention actions for
                    the Matter Layer application.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      aria-describedby="reset-application-description"
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                      data-testid="reset-application-button"
                      onClick={() => {
                        setConfirmationPhrase("");
                        setIsResetDialogOpen(true);
                      }}
                      type="button"
                    >
                      Reset Application
                    </button>
                    {resetApplicationState.status === "success" ? (
                      <p
                        className="text-sm font-semibold text-red-800"
                        data-testid="reset-application-success-message"
                        role="status"
                      >
                        {resetApplicationState.message}
                      </p>
                    ) : null}
                  </div>
                  <p
                    className="mt-3 max-w-2xl text-sm leading-6 text-red-800"
                    id="reset-application-description"
                  >
                    Clicking Reset Application will permanently delete all
                    matters and all data stored in the Matter Layer database.
                    This action is intended for resetting a development or test
                    instance of Matter Layer.
                  </p>
                </div>
                <WarningModal
                  cancelLabel="Cancel"
                  cancelTestId="reset-application-cancel-button"
                  confirmDisabled={!isConfirmationPhraseValid}
                  confirmLabel="Permanently Reset Application"
                  confirmTestId="reset-application-confirm-button"
                  isPending={isResetPending}
                  message="This will permanently delete all matters and all data stored in the Matter Layer database. This action cannot be undone."
                  onCancel={() => {
                    setIsResetDialogOpen(false);
                    setConfirmationPhrase("");
                  }}
                  onConfirm={() => {
                    resetApplicationFormRef.current?.requestSubmit();
                  }}
                  open={isResetDialogOpen}
                  testId="reset-application-confirmation-dialog"
                  title="Reset Application"
                  variant="danger"
                >
                  <form
                    action={submitResetApplication}
                    className="mt-4"
                    ref={resetApplicationFormRef}
                  >
                    <label
                      className="text-sm font-semibold text-[#211B27]"
                      htmlFor="reset-application-confirmation-phrase"
                    >
                      Type RESET MATTER LAYER to confirm.
                    </label>
                    <input
                      autoComplete="off"
                      className="mt-2 w-full rounded-lg border border-[#CFC5DA] bg-white px-3 py-2 text-sm text-[#211B27] outline-none transition-colors focus:border-[#5F4B76] focus:ring-2 focus:ring-[#CFC5DA]"
                      data-testid="reset-application-confirmation-input"
                      id="reset-application-confirmation-phrase"
                      name="confirmationPhrase"
                      onChange={(event) =>
                        setConfirmationPhrase(event.target.value)
                      }
                      value={confirmationPhrase}
                    />
                    <p className="mt-2 text-xs leading-5 text-[#74677F]">
                      Matter Layer database data and locally stored matter
                      document files tracked by database records will be
                      deleted. Admin users, login records, workflows, workflow
                      settings, and AI Provider configuration are preserved.
                    </p>
                    {resetApplicationState.status === "error" ? (
                      <p
                        className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-800"
                        data-testid="reset-application-error-message"
                        role="alert"
                      >
                        {resetApplicationState.message}
                      </p>
                    ) : null}
                  </form>
                </WarningModal>
              </section>
            )}
          </div>
        </AppMainPanel>
      </AppWorkspaceLayout>
    </div>
  );
}

function getPanelDescription(tab: AdminTab) {
  switch (tab) {
    case "AI Providers":
      return "Configure the providers Matter Layer can use for chat and workflows.";
    case "Workflows":
      return "Inspect registered workflows and their execution steps.";
    case "Retention":
      return "Control destructive data-retention actions.";
  }
}

function getCanvasDescription(tab: AdminTab) {
  switch (tab) {
    case "AI Providers":
      return "Configure system-wide settings for AI providers and workflows.";
    case "Workflows":
      return "Review the workflow catalog.";
    case "Retention":
      return "Review destructive reset controls.";
  }
}
