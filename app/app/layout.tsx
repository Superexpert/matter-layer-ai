import { redirect } from "next/navigation";
import { connection } from "next/server";

import { auth } from "@/auth";
import { AppContainer } from "@/components/app-container";
import { AppNav } from "@/components/app-nav";
import { isCurrentUserAdmin } from "@/services/auth";
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
  const isAdmin = await isCurrentUserAdmin();

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <AppNav isAdmin={isAdmin} />
      <AppContainer className="py-8">
        {children}
      </AppContainer>
    </div>
  );
}
