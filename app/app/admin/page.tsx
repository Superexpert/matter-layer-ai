import { UserRole } from "@prisma/client";
import Link from "next/link";

import { listAIProviderConfigs } from "@/services/ai/ai-settings-service";
import { AI_PROVIDER_REGISTRY } from "@/services/ai/provider-registry";
import { getCurrentUser } from "@/services/users";
import {
  listAdminWorkflowSummaries,
  type AdminWorkflowSummary,
} from "@/services/workflows/admin-workflow-catalog";
import { syncBuiltInWorkflows } from "@/services/workflows/catalog-service";

import { AdminAISettingsForm } from "./AdminAISettingsForm";
import { AdminTabs } from "./AdminTabs";
import {
  activateProviderConfig,
  createProviderConfig,
  deleteProviderConfig,
} from "./actions";

type AdminPageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    tab?: string;
  }>;
};

function AdminWorkflowsPanel({
  workflows,
}: {
  workflows: AdminWorkflowSummary[];
}) {
  if (workflows.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-[#CFC5DA] bg-[#FBFAFC] p-4"
        data-testid="admin-workflows-empty"
      >
        <h3 className="text-base font-semibold text-[#211B27]">
          No workflows registered
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#74677F]">
          Registered workflows will appear here once the catalog is populated.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3" data-testid="admin-workflow-list">
      {workflows.map((workflow) => (
        <Link
          className="block rounded-lg border border-[#E3DEEA] bg-white p-4 shadow-[0_1px_2px_rgba(40,29,52,0.04)] transition-colors hover:border-[#B8A9C8] hover:bg-[#FBFAFC]"
          data-testid={`admin-workflow-card-${workflow.id}`}
          href={`/app/admin/workflows/${workflow.id}`}
          key={workflow.id}
        >
          <h3 className="text-base font-semibold text-[#211B27]">
            {workflow.name}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#74677F]">
            {workflow.description}
          </p>
        </Link>
      ))}
    </div>
  );
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const currentUser = await getCurrentUser();

  if (currentUser?.role !== UserRole.ADMIN) {
    return (
      <section className="max-w-3xl" data-testid="admin-unauthorized">
        <h1 className="text-3xl font-semibold text-zinc-950">Admin</h1>
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <h2 className="text-lg font-semibold text-red-950">
            Admin access required
          </h2>
          <p className="mt-2 text-sm leading-6 text-red-800">
            AI has not been configured yet. Please contact an administrator.
          </p>
        </div>
      </section>
    );
  }

  await syncBuiltInWorkflows();

  const [{ error, saved, tab }, aiProviderConfigs, workflows] = await Promise.all([
    searchParams,
    listAIProviderConfigs(),
    listAdminWorkflowSummaries(),
  ]);
  const initialTab = tab === "workflows" ? "Workflows" : "AI Providers";

  return (
    <section className="grid gap-4" data-testid="admin-page">
      <div
        className="flex flex-wrap items-end justify-between gap-3"
        data-testid="admin-context-header"
      >
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
            Matter Layer
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[#211B27]">Admin</h1>
        </div>
        <p className="max-w-sm text-sm leading-6 text-[#74677F]">
          Manage app-wide Matter Layer settings.
        </p>
      </div>

      <AdminTabs
        aiProvidersPanel={
          <>
            {saved === "ai" ? (
              <div
                className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
                data-testid="ai-settings-success"
                role="status"
              >
                AI settings saved.
              </div>
            ) : null}

            {error ? (
              <div
                className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                data-testid="ai-settings-error"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            <AdminAISettingsForm
              activateAction={activateProviderConfig}
              configs={aiProviderConfigs}
              createAction={createProviderConfig}
              deleteAction={deleteProviderConfig}
              providers={AI_PROVIDER_REGISTRY}
            />
          </>
        }
        initialTab={initialTab}
        workflowsPanel={<AdminWorkflowsPanel workflows={workflows} />}
      />
    </section>
  );
}
