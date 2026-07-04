import Link from "next/link";

import {
  AppMainPanel,
  AppSidePanel,
  AppWorkspaceLayout,
} from "@/components/app-workspace";
import { requireAdmin } from "@/services/auth";
import { getAdminWorkflowDetail } from "@/services/workflows/admin-workflow-catalog";
import { syncBuiltInWorkflows } from "@/services/workflows/catalog-service";

type AdminWorkflowDetailPageProps = {
  params: Promise<{
    workflowId: string;
  }>;
};

function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#E3DEEA] bg-[#FBFAFC] px-2.5 py-1 text-xs font-semibold text-[#5F4B76]">
      {children}
    </span>
  );
}

export default async function AdminWorkflowDetailPage({
  params,
}: AdminWorkflowDetailPageProps) {
  await requireAdmin();
  await syncBuiltInWorkflows();

  const { workflowId } = await params;
  const workflow = await getAdminWorkflowDetail(workflowId);

  if (!workflow) {
    return (
      <section className="grid gap-4" data-testid="admin-workflow-not-found">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
            Admin Workflows
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[#211B27]">
            Workflow not found
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#74677F]">
            Matter Layer could not find a registered workflow with the id{" "}
            <span className="font-semibold text-[#211B27]">{workflowId}</span>.
          </p>
        </div>
        <Link
          className="inline-flex h-9 w-fit items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861]"
          href="/app/admin?tab=workflows"
        >
          Back to workflows
        </Link>
      </section>
    );
  }

  return (
    <section className="grid gap-4" data-testid="admin-workflow-detail-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            className="text-sm font-semibold text-[#5F4B76] hover:text-[#4B3861]"
            href="/app/admin?tab=workflows"
          >
            Back to workflows
          </Link>
          <p className="mt-4 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
            Admin Workflows
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[#211B27]">
            {workflow.name}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge>{workflow.id}</StatusBadge>
          <StatusBadge>
            {workflow.stepCount} step{workflow.stepCount === 1 ? "" : "s"}
          </StatusBadge>
          <StatusBadge>{workflow.isBuiltIn ? "Built-in" : "Custom"}</StatusBadge>
          {workflow.isSystem ? <StatusBadge>Default workflow</StatusBadge> : null}
        </div>
      </div>

      <AppWorkspaceLayout
        sidebar={
          <AppSidePanel testId="admin-workflow-detail-side-panel">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
              Workflow
            </p>
            <h2 className="mt-2 text-base font-semibold text-[#211B27]">
              Metadata
            </h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="font-semibold text-[#211B27]">Workflow id</dt>
                <dd className="mt-1 text-[#74677F]">{workflow.id}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#211B27]">Source</dt>
                <dd className="mt-1 text-[#74677F]">
                  {workflow.isBuiltIn ? "Built-in workflow" : "Custom workflow"}
                  {workflow.isSystem ? ", default workflow" : ""}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#211B27]">Status</dt>
                <dd className="mt-1 text-[#74677F]">
                  {workflow.isEnabled ? "Enabled" : "Disabled"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#211B27]">Step count</dt>
                <dd className="mt-1 text-[#74677F]">{workflow.stepCount}</dd>
              </div>
            </dl>
          </AppSidePanel>
        }
        testId="admin-workflow-detail-layout"
      >
        <AppMainPanel className="p-5" testId="admin-workflow-detail-main-panel">
          <div className="border-b border-[#E3DEEA] pb-4">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
              Workflow detail
            </p>
            <h2 className="mt-2 text-xl font-semibold text-[#211B27]">
              {workflow.name}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#74677F]">
              {workflow.description}
            </p>
          </div>

          <ol className="mt-5 grid gap-3" data-testid="admin-workflow-step-list">
            {workflow.steps.map((step, index) => (
              <li
                className="rounded-lg border border-[#E3DEEA] bg-white p-4"
                data-testid="admin-workflow-step"
                key={step.id}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F3F0F7] text-sm font-semibold text-[#5F4B76]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[#211B27]">
                        {step.name}
                      </h3>
                      <span className="rounded-full bg-[#FBFAFC] px-2.5 py-1 text-xs font-semibold text-[#74677F]">
                        {step.typeLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-[#74677F]">
                      {step.type}
                    </p>
                    {step.description ? (
                      <p className="mt-2 text-sm leading-6 text-[#74677F]">
                        {step.description}
                      </p>
                    ) : null}
                    {step.configurationSummary.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {step.configurationSummary.map((summary) => (
                          <li
                            className="rounded-full bg-[#F3F0F7] px-2.5 py-1 text-xs font-medium text-[#5F4B76]"
                            key={summary}
                          >
                            {summary}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </AppMainPanel>
      </AppWorkspaceLayout>
    </section>
  );
}
