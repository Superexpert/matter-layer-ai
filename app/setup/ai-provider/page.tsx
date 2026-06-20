import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI provider setup moved | Matter Layer",
  description: "Configure AI provider settings from the Admin page.",
};

export default function AIProviderSetupPage() {
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
            AI provider setup is managed by Admins
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-zinc-700">
            AI provider, model, and API key settings are now stored in the
            Matter Layer database instead of <code className="font-mono">.env.local</code>.
          </p>
          <Link
            className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[#42305B] px-4 text-sm font-semibold text-white hover:bg-[#312342]"
            href="/app/admin"
          >
            Open Admin settings
          </Link>
        </div>
      </section>
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10 sm:px-8 lg:px-10">
        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Configure AI from Admin
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-700">
            <li>Sign in as the first Admin.</li>
            <li>
              Open <code className="font-mono">/app/admin</code>.
            </li>
            <li>Select the AI provider.</li>
            <li>Select the model.</li>
            <li>Enter the provider API key and save settings.</li>
          </ol>
        </div>
      </section>
    </main>
  );
}
