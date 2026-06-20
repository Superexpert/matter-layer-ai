"use client";

import { useMemo, useState } from "react";

import type { AIProviderConfigSummary } from "@/services/ai/ai-settings-service";
import type { AIProviderRegistration } from "@/services/ai/provider-registry";

type AdminAISettingsFormProps = {
  activateAction: (formData: FormData) => void;
  configs: AIProviderConfigSummary[];
  createAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  providers: readonly AIProviderRegistration[];
};

export function AdminAISettingsForm({
  activateAction,
  configs,
  createAction,
  deleteAction,
  providers,
}: AdminAISettingsFormProps) {
  const initialProvider = providers[0]?.id ?? "";
  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider);
  const selectedProviderRegistration = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider),
    [providers, selectedProvider],
  );
  const models = selectedProviderRegistration?.models ?? [];
  const finalProviderRemaining = configs.length <= 1;

  return (
    <div className="mt-6 grid gap-8">
      <section data-testid="configured-ai-providers-section">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-zinc-950">
            Configured AI providers
          </h3>
          <p className="text-sm leading-6 text-zinc-700">
            Only one AI provider is active at a time.
          </p>
          <p className="text-sm leading-6 text-zinc-700">
            API keys are stored server-side. Only the last 6 characters are
            shown here.
          </p>
        </div>

        {configs.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-700"
            data-testid="no-ai-providers"
          >
            No AI providers are configured yet.
          </div>
        ) : (
          <ul className="mt-4 grid gap-4" data-testid="ai-provider-cards">
            {configs.map((config) => (
              <li
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
                data-testid="ai-provider-card"
                key={config.id}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-semibold text-zinc-950">
                        {config.providerName}
                      </h4>
                      {config.isActive ? (
                        <span
                          className="rounded-md bg-[#EFE8F7] px-2 py-1 text-xs font-semibold text-[#42305B]"
                          data-testid="active-provider-badge"
                        >
                          Active
                        </span>
                      ) : null}
                    </div>
                    <dl className="mt-4 grid gap-2 text-sm">
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-zinc-600">Model</dt>
                        <dd
                          className="font-medium text-zinc-950"
                          data-testid="provider-model"
                        >
                          {config.modelLabel}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-zinc-600">API key</dt>
                        <dd
                          className="font-mono text-zinc-950"
                          data-testid="provider-api-key-masked"
                        >
                          {config.apiKeyMasked ?? "Not configured"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {config.isActive ? null : (
                      <form action={activateAction}>
                        <input name="configId" type="hidden" value={config.id} />
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-3 text-sm font-semibold text-[#42305B] hover:bg-[#F7F6FA]"
                          data-testid="activate-provider-button"
                          type="submit"
                        >
                          Make active
                        </button>
                      </form>
                    )}
                    <form action={deleteAction}>
                      <input name="configId" type="hidden" value={config.id} />
                      <button
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                        data-testid="delete-provider-button"
                        disabled={finalProviderRemaining || config.isActive}
                        onClick={(event) => {
                          if (
                            !window.confirm(
                              "Delete this AI provider configuration?",
                            )
                          ) {
                            event.preventDefault();
                          }
                        }}
                        type="submit"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
                {finalProviderRemaining ? (
                  <p
                    className="mt-4 text-sm leading-6 text-zinc-600"
                    data-testid="final-provider-delete-help"
                  >
                    Add another provider before deleting this one.
                  </p>
                ) : null}
                {config.isActive && configs.length > 1 ? (
                  <p
                    className="mt-4 text-sm leading-6 text-zinc-600"
                    data-testid="active-provider-delete-help"
                  >
                    Activate another provider before deleting this one.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div>
          <h3 className="text-lg font-semibold text-zinc-950">
            Add AI provider
          </h3>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            Saving a new provider makes it active.
          </p>
        </div>

        <form
          action={createAction}
          className="mt-4 grid gap-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
          data-testid="ai-provider-form"
        >
          <div>
            <label
              className="block text-sm font-semibold text-zinc-950"
              htmlFor="aiProvider"
            >
              AI Provider
            </label>
            <select
              className="mt-2 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
              data-testid="ai-provider-select"
              id="aiProvider"
              name="aiProvider"
              onChange={(event) => setSelectedProvider(event.target.value)}
              value={selectedProvider}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-semibold text-zinc-950"
              htmlFor="aiModel"
            >
              Model
            </label>
            <select
              className="mt-2 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
              data-testid="ai-model-select"
              defaultValue={models[0]?.id}
              id="aiModel"
              key={selectedProvider}
              name="aiModel"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-semibold text-zinc-950"
              htmlFor="aiApiKey"
            >
              {selectedProviderRegistration?.apiKeyLabel ?? "API Key"}
            </label>
            <input
              autoComplete="off"
              className="mt-2 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
              data-testid="ai-api-key-input"
              id="aiApiKey"
              name="aiApiKey"
              placeholder="Enter API key"
              type="password"
            />
          </div>

          <div>
            <button
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#42305B] px-4 text-sm font-semibold text-white hover:bg-[#312342]"
              data-testid="save-ai-settings-button"
              type="submit"
            >
              Save AI provider
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
