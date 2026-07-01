"use client";

import { useMemo, useState } from "react";

import type { AIProviderConfigSummary } from "@/services/ai/ai-settings-service";
import {
  OLLAMA_DEFAULT_BASE_URL,
  type AIProviderRegistration,
} from "@/services/ai/provider-registry";
import { getPreferredOllamaModel } from "@/services/ai/providers/ollama-setup";

type AdminAISettingsFormProps = {
  activateAction: (formData: FormData) => void;
  configs: AIProviderConfigSummary[];
  createAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  providers: readonly AIProviderRegistration[];
};

type OllamaStatus = "idle" | "checking" | "available" | "testing" | "tested" | "unavailable";

type OllamaModelResponse =
  | {
      available: true;
      baseUrl: string;
      models: string[];
    }
  | {
      available: false;
      baseUrl?: string;
      error: string;
    };

type OllamaTestResponse =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

async function postJson<TResponse>(url: string, body: Record<string, string>) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return (await response.json()) as TResponse;
}

function hasGemmaModel(models: string[]) {
  return models.some((model) => model.toLowerCase().includes("gemma"));
}

export function AdminAISettingsForm({
  activateAction,
  configs,
  createAction,
  deleteAction,
  providers,
}: AdminAISettingsFormProps) {
  const initialProvider = providers[0]?.id ?? "";
  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider);
  const initialProviderRegistration = providers.find(
    (provider) => provider.id === initialProvider,
  );
  const [selectedCloudModel, setSelectedCloudModel] = useState(
    initialProviderRegistration?.defaultModel ??
      initialProviderRegistration?.models[0]?.id ??
      "",
  );
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(OLLAMA_DEFAULT_BASE_URL);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("idle");
  const [ollamaMessage, setOllamaMessage] = useState("");
  const [cardTestMessages, setCardTestMessages] = useState<Record<string, string>>(
    {},
  );
  const selectedProviderRegistration = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider),
    [providers, selectedProvider],
  );
  const models = selectedProviderRegistration?.models ?? [];
  const defaultModel = selectedProviderRegistration?.defaultModel ?? models[0]?.id ?? "";
  const finalProviderRemaining = configs.length <= 1;
  const isOllamaSelected = selectedProvider === "ollama";
  const ollamaCanSave =
    (ollamaStatus === "available" || ollamaStatus === "tested") &&
    selectedOllamaModel.trim().length > 0;
  const showNoGemmaWarning =
    isOllamaSelected &&
    ollamaModels.length > 0 &&
    !hasGemmaModel(ollamaModels);

  function resetOllamaValidation(nextBaseUrl = ollamaBaseUrl) {
    setOllamaBaseUrl(nextBaseUrl);
    setOllamaModels([]);
    setSelectedOllamaModel("");
    setOllamaStatus("idle");
    setOllamaMessage("");
  }

  async function refreshOllamaModels() {
    setOllamaStatus("checking");
    setOllamaMessage("");

    const result = await postJson<OllamaModelResponse>(
      "/api/admin/ollama/models",
      {
        baseUrl: ollamaBaseUrl,
      },
    );

    if (!result.available) {
      setOllamaModels([]);
      setSelectedOllamaModel("");
      setOllamaStatus("unavailable");
      setOllamaMessage(
        result.error ||
          `Matter Layer could not reach Ollama at ${ollamaBaseUrl}. Make sure Ollama is installed and running on the Matter Layer server.`,
      );
      return;
    }

    const preferredModel = getPreferredOllamaModel(result.models);

    setOllamaBaseUrl(result.baseUrl);
    setOllamaModels(result.models);
    setSelectedOllamaModel(preferredModel);
    setOllamaStatus("available");
    setOllamaMessage(
      result.models.length > 0
        ? "Ollama is running. Select an installed model to use."
        : "Ollama is running, but no models are installed yet. Ask your administrator to install a Gemma model in Ollama.",
    );
  }

  async function testOllamaConnection() {
    if (!selectedOllamaModel) {
      await refreshOllamaModels();
      return;
    }

    setOllamaStatus("testing");
    setOllamaMessage("");

    const result = await postJson<OllamaTestResponse>("/api/admin/ollama/test", {
      baseUrl: ollamaBaseUrl,
      model: selectedOllamaModel,
    });

    if (result.ok) {
      setOllamaStatus("tested");
      setOllamaMessage(result.message);
      return;
    }

    setOllamaStatus("unavailable");
    setOllamaMessage(result.error);
  }

  async function testSavedOllamaConfig(config: AIProviderConfigSummary) {
    if (!config.baseUrl) {
      return;
    }

    setCardTestMessages((messages) => ({
      ...messages,
      [config.id]: "Testing Ollama...",
    }));

    const result = await postJson<OllamaTestResponse>("/api/admin/ollama/test", {
      baseUrl: config.baseUrl,
      model: config.model,
    });

    setCardTestMessages((messages) => ({
      ...messages,
      [config.id]: result.ok ? result.message : result.error,
    }));
  }

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
            {configs.map((config) => {
              const isOllamaConfig = config.provider === "ollama";

              return (
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
                        {isOllamaConfig ? (
                          <div className="flex gap-2">
                            <dt className="w-24 shrink-0 text-zinc-600">
                              Server
                            </dt>
                            <dd
                              className="font-medium text-zinc-950"
                              data-testid="provider-base-url"
                            >
                              {config.baseUrl}
                            </dd>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <dt className="w-24 shrink-0 text-zinc-600">
                              API key
                            </dt>
                            <dd
                              className="font-mono text-zinc-950"
                              data-testid="provider-api-key-masked"
                            >
                              {config.apiKeyMasked ?? "Not configured"}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {isOllamaConfig ? (
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-3 text-sm font-semibold text-[#42305B] hover:bg-[#F7F6FA]"
                          data-testid="test-provider-button"
                          onClick={() => void testSavedOllamaConfig(config)}
                          type="button"
                        >
                          Test
                        </button>
                      ) : null}
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
                  {cardTestMessages[config.id] ? (
                    <p
                      className="mt-4 text-sm leading-6 text-zinc-700"
                      data-testid="provider-test-message"
                    >
                      {cardTestMessages[config.id]}
                    </p>
                  ) : null}
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
              );
            })}
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
              onChange={(event) => {
                const nextProvider = event.target.value;
                const nextRegistration = providers.find(
                  (provider) => provider.id === nextProvider,
                );

                setSelectedProvider(nextProvider);
                setSelectedCloudModel(
                  nextRegistration?.defaultModel ??
                    nextRegistration?.models[0]?.id ??
                    "",
                );

                if (nextProvider === "ollama") {
                  resetOllamaValidation(OLLAMA_DEFAULT_BASE_URL);
                }
              }}
              value={selectedProvider}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          {isOllamaSelected ? (
            <>
              <div
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700"
                data-testid="ollama-helper-copy"
              >
                Use this option when Matter Layer is running on a law firm
                intranet and Ollama is installed on the same server or another
                internal server.
              </div>

              <div>
                <label
                  className="block text-sm font-semibold text-zinc-950"
                  htmlFor="ollamaBaseUrl"
                >
                  Ollama server URL
                </label>
                <input
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                  data-testid="ollama-base-url-input"
                  id="ollamaBaseUrl"
                  key="ollama-base-url-input"
                  name="ollamaBaseUrl"
                  onChange={(event) => resetOllamaValidation(event.target.value)}
                  type="url"
                  value={ollamaBaseUrl}
                />
                <p
                  className="mt-2 text-sm leading-6 text-zinc-600"
                  data-testid="ollama-base-url-help"
                >
                  Default: http://localhost:11434. Use a different internal URL
                  only if Ollama is running on another server.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#42305B] hover:bg-[#F7F6FA] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                  data-testid="refresh-ollama-models-button"
                  disabled={ollamaStatus === "checking"}
                  onClick={() => void refreshOllamaModels()}
                  type="button"
                >
                  Refresh models
                </button>
                <button
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#42305B] hover:bg-[#F7F6FA] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                  data-testid="test-ollama-connection-button"
                  disabled={
                    ollamaStatus === "checking" || ollamaStatus === "testing"
                  }
                  onClick={() => void testOllamaConnection()}
                  type="button"
                >
                  Test connection
                </button>
              </div>

              <div>
                <label
                  className="block text-sm font-semibold text-zinc-950"
                  htmlFor="aiModel"
                >
                  Installed model
                </label>
                <select
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                  data-testid="ollama-model-select"
                  disabled={ollamaModels.length === 0}
                  id="aiModel"
                  key="ollama-model-select"
                  name="aiModel"
                  onChange={(event) => {
                    setSelectedOllamaModel(event.target.value);
                    setOllamaStatus(
                      ollamaStatus === "tested" ? "available" : ollamaStatus,
                    );
                  }}
                  value={selectedOllamaModel}
                >
                  {ollamaModels.length === 0 ? (
                    <option value="">No installed models found</option>
                  ) : (
                    ollamaModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {ollamaMessage ? (
                <p
                  className="text-sm leading-6 text-zinc-700"
                  data-testid="ollama-status-message"
                >
                  {ollamaMessage}
                </p>
              ) : null}
              {showNoGemmaWarning ? (
                <p
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
                  data-testid="ollama-gemma-warning"
                >
                  No Gemma model was found. Matter Layer can use the selected
                  model, but Gemma is the recommended local model family.
                </p>
              ) : null}
            </>
          ) : (
            <>
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
                  id="aiModel"
                  key={selectedProvider}
                  name="aiModel"
                  onChange={(event) => setSelectedCloudModel(event.target.value)}
                  value={selectedCloudModel || defaultModel}
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
                  key="cloud-api-key-input"
                  name="aiApiKey"
                  placeholder="Enter API key"
                  type="password"
                />
              </div>
            </>
          )}

          <div>
            <button
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#42305B] px-4 text-sm font-semibold text-white hover:bg-[#312342] disabled:cursor-not-allowed disabled:bg-zinc-400"
              data-testid="save-ai-settings-button"
              disabled={isOllamaSelected && !ollamaCanSave}
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
