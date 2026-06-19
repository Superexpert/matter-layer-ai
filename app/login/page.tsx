import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getServerSession } from "next-auth";

import { getAuthOptions } from "@/auth";
import { requireAppSetup } from "@/services/setup";
import { GoogleSignInButton } from "./GoogleSignInButton";

export const metadata: Metadata = {
  title: "Sign in | Matter Layer",
  description: "Sign in to Matter Layer with Google.",
};

export default async function LoginPage() {
  await connection();
  await requireAppSetup();

  const session = await getServerSession(getAuthOptions());

  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen bg-zinc-50 text-zinc-950">
      <section className="mx-auto flex w-full max-w-5xl flex-col justify-center gap-8 px-6 py-16 sm:px-8 lg:px-10">
        <div className="max-w-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <p className="text-sm font-semibold uppercase text-[#5c6f47]">
            Matter Layer
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">
            Sign in required
          </h1>
          <p className="mt-4 text-base leading-7 text-zinc-700">
            Use your Google Workspace account to access Matter Layer.
          </p>
          <div className="mt-8">
            <GoogleSignInButton />
          </div>
        </div>
      </section>
    </main>
  );
}
