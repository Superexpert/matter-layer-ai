import type { Metadata } from "next";
import { connection } from "next/server";

import { getSetupCheck, getSetupStatus } from "@/services/setup";

export const metadata: Metadata = {
  title: "Database setup required | Matter Layer",
  description: "Configure the PostgreSQL DATABASE_URL for Matter Layer.",
};

export default async function DatabaseSetupPage() {
  await connection();

  const setupStatus = await getSetupStatus();
  const check = getSetupCheck(setupStatus, "database");
  const isReady = check.status === "ready";

  return (
    <main
      className="min-h-screen bg-zinc-50 text-zinc-950"
      data-testid="database-setup-instructions"
    >
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-10 sm:px-8 lg:px-10">
          <p className="text-sm font-semibold uppercase text-[#5c6f47]">
            Matter Layer configuration
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
            Database setup required
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-zinc-700">
            {isReady
              ? "Matter Layer found the required Postgres configuration."
              : "Matter Layer needs a PostgreSQL database connection string before it can load or create matter data."}
          </p>
          {!isReady ? (
            <div className="border-l-4 border-[#b24a3b] bg-[#fff4f0] p-5">
              <h2 className="text-lg font-semibold text-zinc-950">
                Database configuration is incomplete
              </h2>
              {check.message ? (
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  {check.message}
                </p>
              ) : null}
              <p className="mt-2 text-sm leading-6 text-zinc-700">
                The following environment variables are missing:
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {check.missingEnvVars.map((envVar) => (
                  <li
                    className="border border-[#e5b2a6] bg-white px-3 py-1 font-mono text-sm text-[#8b2f23]"
                    data-testid="missing-database-env-var"
                    key={envVar}
                  >
                    {envVar}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                Add <code className="font-mono">DATABASE_URL</code> to{" "}
                <code className="font-mono">.env.local</code>, then restart the
                dev server.
              </p>
            </div>
          ) : (
            <div className="border-l-4 border-[#5c6f47] bg-[#f4f8ef] p-5">
              <h2 className="text-lg font-semibold text-zinc-950">
                Database configuration is present
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-700">
                Continue to Matter Layer when the rest of setup is complete.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10 sm:px-8 lg:px-10">
        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Add DATABASE_URL
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-700">
            Add <code className="font-mono">DATABASE_URL</code> to{" "}
            <code className="font-mono">.env.local</code>.
          </p>
          <pre className="mt-4 overflow-x-auto bg-zinc-950 p-4 text-sm leading-6 text-zinc-50">
            <code>{`DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"`}</code>
          </pre>
        </div>

        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Prepare the database
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-700">
            The PostgreSQL database must exist before preparing the Prisma
            schema. After editing <code className="font-mono">.env.local</code>,
            restart the dev server.
          </p>
          <pre className="mt-4 overflow-x-auto bg-zinc-950 p-4 text-sm leading-6 text-zinc-50">
            <code>{`npm run db:push`}</code>
          </pre>
          
        </div>
      </section>
    </main>
  );
}
