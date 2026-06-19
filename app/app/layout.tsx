import { redirect } from "next/navigation";
import { connection } from "next/server";

import { auth } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { requireAppSetup } from "@/services/setup";

export default async function AuthenticatedAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  await requireAppSetup();

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <AppNav />
      <main className="mx-auto w-full max-w-6xl px-6 py-8 sm:px-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}
