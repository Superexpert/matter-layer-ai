import type { Metadata } from "next";
import { connection } from "next/server";

import { getSetupCheck, getSetupStatus } from "@/services/setup";

export const metadata: Metadata = {
  title: "AI provider setup required | Matter Layer",
  description: "Configure the server-side AI provider for Matter Layer.",
};

function MissingEnvVars({ envVars }: { envVars: string[] }) {
  if (envVars.length === 0) {
    return null;
  }

  return (
    <>
      <p className="mt-2 text-sm leading-6 text-zinc-700">
        The following environment variables are missing:
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {envVars.map((envVar) => (
          <li
            className="border border-[#e5b2a6] bg-white px-3 py-1 font-mono text-sm text-[#8b2f23]"
            data-testid="missing-ai-env-var"
            key={envVar}
          >
            {envVar}
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function AIProviderSetupPage() {
  await connection();

  const setupStatus = await getSetupStatus();
  const check = getSetupCheck(setupStatus, "ai-provider");
  const isReady = check.status === "ready";

  return (
    <main
      className="min-h-screen bg-zinc-50 text-zinc-950"
      data-testid="ai-provider-setup-instructions"
    >
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-10 sm:px-8 lg:px-10">
          <p className="text-sm font-semibold uppercase text-[#5c6f47]">
            Matter Layer configuration
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
            AI provider setup required
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-zinc-700">
            Matter Layer uses a server-side AI provider to power chat and future
            workflows. OpenAI is the first supported provider.
          </p>

          {isReady ? (
            <div className="border-l-4 border-[#5c6f47] bg-[#f4f8ef] p-5">
              <h2 className="text-lg font-semibold text-zinc-950">
                AI provider configuration is present
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-700">
                Matter Layer found the required AI provider environment
                variables.
              </p>
            </div>
          ) : (
            <div className="border-l-4 border-[#b24a3b] bg-[#fff4f0] p-5">
              <h2 className="text-lg font-semibold text-zinc-950">
                AI provider configuration is incomplete
              </h2>
              {check.message ? (
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  {check.message}
                </p>
              ) : null}
              <MissingEnvVars envVars={check.missingEnvVars} />
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                Add these values to{" "}
                <code className="font-mono">.env.local</code>, then restart the
                dev server.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10 sm:px-8 lg:px-10">
        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Configure OpenAI
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-700">
            Add this block to <code className="font-mono">.env.local</code>:
          </p>
          <pre className="mt-4 overflow-x-auto bg-zinc-950 p-4 text-sm leading-6 text-zinc-50">
            <code>{`AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
AI_OPENAI_MODEL=gpt-5`}</code>
          </pre>
        </div>

        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Server-side provider calls
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-700">
            OpenAI calls are made only from server-side Matter Layer services.
            The OpenAI API key is not exposed to browser code.
          </p>
          <p className="mt-3 text-sm leading-6 text-zinc-700">
            Matter Layer sends message history explicitly with each request and
            uses stateless provider calls with provider-side response storage
            disabled where supported.
          </p>
        </div>
      </section>
    </main>
  );
}
