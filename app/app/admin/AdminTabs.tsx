"use client";

import { ReactNode, useState } from "react";
import { useRouter } from "next/navigation";

import { AppTabs } from "@/components/app-tabs";
import {
  AppMainPanel,
  AppSidePanel,
  AppWorkspaceLayout,
} from "@/components/app-workspace";

type AdminTab = "AI Providers" | "Workflows";

type AdminTabsProps = {
  aiProvidersPanel: ReactNode;
  initialTab?: AdminTab;
  workflowsPanel: ReactNode;
};

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
] as const;

export function AdminTabs({
  aiProvidersPanel,
  initialTab = "AI Providers",
  workflowsPanel,
}: AdminTabsProps) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<AdminTab>(initialTab);
  const panelDescription =
    selectedTab === "AI Providers"
      ? "Configure the providers Matter Layer can use for chat and workflows."
      : "Inspect registered workflows and their execution steps.";
  const canvasDescription =
    selectedTab === "AI Providers"
      ? "Configure system-wide settings for AI providers and workflows."
      : "Review the workflow catalog.";

  return (
    <div>
      <AppTabs
        ariaLabel="Admin navigation"
        onSelect={(tab) => {
          setSelectedTab(tab);

          if (tab === "Workflows") {
            router.push("/app/admin?tab=workflows");
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
            ) : (
              <section data-testid="admin-workflows-panel">
                {workflowsPanel}
              </section>
            )}
          </div>
        </AppMainPanel>
      </AppWorkspaceLayout>
    </div>
  );
}
