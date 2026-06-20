import { UserRole } from "@prisma/client";

import { listAIProviderConfigs } from "@/services/ai/ai-settings-service";
import { AI_PROVIDER_REGISTRY } from "@/services/ai/provider-registry";
import { getCurrentUser } from "@/services/users";

import { AdminAISettingsForm } from "./AdminAISettingsForm";
import {
  activateProviderConfig,
  createProviderConfig,
  deleteProviderConfig,
} from "./actions";

type AdminPageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

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

  const [{ error, saved }, aiProviderConfigs] = await Promise.all([
    searchParams,
    listAIProviderConfigs(),
  ]);

  return (
    <section className="max-w-4xl" data-testid="admin-page">
      <div>
        <h1 className="text-3xl font-semibold text-zinc-950">Admin</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-700">
          Manage app-wide Matter Layer settings.
        </p>
      </div>

      {saved === "ai" ? (
        <div
          className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
          data-testid="ai-settings-success"
          role="status"
        >
          AI settings saved.
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          data-testid="ai-settings-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <section className="mt-8">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-950">
            AI providers
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            Configure the providers Matter Layer can use for chat and future
            workflows.
          </p>
        </div>

        <AdminAISettingsForm
          activateAction={activateProviderConfig}
          configs={aiProviderConfigs}
          createAction={createProviderConfig}
          deleteAction={deleteProviderConfig}
          providers={AI_PROVIDER_REGISTRY}
        />
      </section>
    </section>
  );
}
