import "server-only";

import { getConfiguredAISettings } from "../ai-settings-service";
import { createAIProviderFromSettings } from "./provider-factory-core";

export async function createConfiguredAIProvider() {
  const settings = await getConfiguredAISettings();

  return createAIProviderFromSettings(settings);
}
