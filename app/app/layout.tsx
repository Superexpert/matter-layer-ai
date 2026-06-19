import { redirect } from "next/navigation";
import { connection } from "next/server";

import { auth } from "@/auth";
import { AppContainer } from "@/components/app-container";
import { AppNav } from "@/components/app-nav";
import { requireAppSetup } from "@/services/setup";
import { ensureUserForSession } from "@/services/users";

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

  await ensureUserForSession(session);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <AppNav />
      <AppContainer className="py-8">
        {children}
      </AppContainer>
    </div>
  );
}
