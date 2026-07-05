import Link from "next/link";

import {
  AppMainPanel,
  AppSidePanel,
  AppWorkspaceLayout,
} from "@/components/app-workspace";
import { requireAdmin } from "@/services/auth";
import { listAIProviderConfigs } from "@/services/ai/ai-settings-service";
import {
  type AdminWorkflowStepSettingDetail,
  getAdminWorkflowDetailWithSettings,
} from "@/services/workflows/admin-workflow-catalog";
import { syncBuiltInWorkflows } from "@/services/workflows/catalog-service";

import { saveWorkflowStepSettingAction } from "../../actions";

type AdminWorkflowDetailPageProps = {
  params: Promise<{
    workflowId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#E3DEEA] bg-[#FBFAFC] px-2.5 py-1 text-xs font-semibold text-[#5F4B76]">
      {children}
    </span>
  );
}

function settingValueAsString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function WorkflowStepSettingField({
  aiProviderOptions,
  setting,
  stepId,
  workflowId,
}: {
  aiProviderOptions: Array<{ id: string; label: string }>;
  setting: AdminWorkflowStepSettingDetail;
  stepId: string;
  workflowId: string;
}) {
  const inputClassName =
    "mt-2 w-full rounded-lg border border-[#D8D0E2] bg-white px-3 py-2 text-sm text-[#211B27] outline-none transition-colors focus:border-[#5F4B76] focus:ring-2 focus:ring-[#5F4B76]/15";

  return (
    <form
      action={saveWorkflowStepSettingAction}
      className="rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] p-4"
      data-testid={`admin-workflow-step-setting-${stepId}-${setting.definition.key}`}
    >
      <input name="workflowId" type="hidden" value={workflowId} />
      <input name="stepId" type="hidden" value={stepId} />
      <input name="settingKey" type="hidden" value={setting.definition.key} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <label
            className="text-sm font-semibold text-[#211B27]"
            htmlFor={`${stepId}-${setting.definition.key}`}
          >
            {setting.definition.label}
          </label>
          <p className="mt-1 text-sm leading-6 text-[#74677F]">
            {setting.definition.description}
          </p>
        </div>
        {setting.isPersisted ? (
          <span className="rounded-full bg-[#F3F0F7] px-2.5 py-1 text-xs font-medium text-[#5F4B76]">
            Custom
          </span>
        ) : null}
      </div>

      {setting.definition.type === "aiProvider" ? (
        <select
          className={inputClassName}
          data-testid={`admin-setting-input-${stepId}-${setting.definition.key}`}
          defaultValue={settingValueAsString(setting.value)}
          id={`${stepId}-${setting.definition.key}`}
          name="settingValue"
        >
          <option value="">Use default AI Provider</option>
          {aiProviderOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {setting.definition.type === "select" ? (
        <select
          className={inputClassName}
          data-testid={`admin-setting-input-${stepId}-${setting.definition.key}`}
          defaultValue={settingValueAsString(setting.value)}
          id={`${stepId}-${setting.definition.key}`}
          name="settingValue"
        >
          {setting.definition.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {setting.definition.type === "text" ? (
        <input
          className={inputClassName}
          data-testid={`admin-setting-input-${stepId}-${setting.definition.key}`}
          defaultValue={settingValueAsString(setting.value)}
          id={`${stepId}-${setting.definition.key}`}
          name="settingValue"
          placeholder={setting.definition.placeholder}
          type="text"
        />
      ) : null}

      {setting.definition.type === "textarea" ? (
        <textarea
          className={`${inputClassName} min-h-28`}
          data-testid={`admin-setting-input-${stepId}-${setting.definition.key}`}
          defaultValue={settingValueAsString(setting.value)}
          id={`${stepId}-${setting.definition.key}`}
          name="settingValue"
          placeholder={setting.definition.placeholder}
        />
      ) : null}

      {setting.warning ? (
        <p
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900"
          data-testid={`admin-setting-warning-${stepId}-${setting.definition.key}`}
        >
          {setting.warning}
        </p>
      ) : null}

      <div className="mt-3">
        <button
          className="inline-flex h-9 items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861]"
          type="submit"
        >
          Save setting
        </button>
      </div>
    </form>
  );
}

export default async function AdminWorkflowDetailPage({
  params,
  searchParams,
}: AdminWorkflowDetailPageProps) {
  await requireAdmin();
  await syncBuiltInWorkflows();

  const [{ workflowId }, { error, saved }, aiProviderConfigs] = await Promise.all([
    params,
    searchParams,
    listAIProviderConfigs(),
  ]);
  const workflow = await getAdminWorkflowDetailWithSettings(workflowId);
  const aiProviderOptions = aiProviderConfigs.map((config) => ({
    id: config.id,
    label: `${config.providerName} - ${config.modelLabel}`,
  }));

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
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#74677F]">
            {workflow.description}
          </p>
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
              Workflow settings
            </p>
            <h2 className="mt-2 text-xl font-semibold text-[#211B27]">
              Steps
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#74677F]">
              Configure only the settings each workflow step exposes.
            </p>
          </div>
          {saved ? (
            <div
              className="mt-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
              data-testid="workflow-step-setting-success"
              role="status"
            >
              Workflow step setting saved.
            </div>
          ) : null}
          {error ? (
            <div
              className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              data-testid="workflow-step-setting-error"
              role="alert"
            >
              {error}
            </div>
          ) : null}

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
                    {step.adminSettings.length > 0 ? (
                      <div className="mt-4 grid gap-3">
                        {step.description ? (
                          <p className="text-sm leading-6 text-[#74677F]">
                            {step.description}
                          </p>
                        ) : null}
                        {step.adminSettings.map((setting) => (
                          <WorkflowStepSettingField
                            aiProviderOptions={aiProviderOptions}
                            key={setting.definition.key}
                            setting={setting}
                            stepId={step.id}
                            workflowId={workflow.id}
                          />
                        ))}
                      </div>
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
