import { redirect } from "next/navigation";

import { requireConfiguredAISettings } from "@/services/ai/ai-settings-service";

export default async function AppHomePage() {
  await requireConfiguredAISettings();

  redirect("/app/matters");
}
