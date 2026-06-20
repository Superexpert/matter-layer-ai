import { connection } from "next/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ensureUserForSession } from "@/services/users";
import { requireConfiguredAISettings } from "@/services/ai/ai-settings-service";
import { requireAppSetup } from "@/services/setup";

export default async function Home() {
  await connection();

  await requireAppSetup();

  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  await ensureUserForSession(session);
  await requireConfiguredAISettings();

  redirect("/app/matters");
}
