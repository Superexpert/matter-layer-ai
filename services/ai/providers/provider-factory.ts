import "server-only";

import {
  getConfiguredAISettings,
  type ConfiguredAISettings,
} from "../ai-settings-service";
import { createAIProviderFromSettings } from "./provider-factory-core";

export async function createConfiguredAIProvider() {
  const settings = await getConfiguredAISettings();

  return createAIProviderFromSettings(settings);
}

export function createConfiguredAIProviderFromSettings(
  settings: ConfiguredAISettings,
) {
  return createAIProviderFromSettings(settings);
}
