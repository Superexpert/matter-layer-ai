import { describe, expect, it } from "vitest";

import {
  getAIProviderRegistration,
  isRegisteredAIModel,
} from "@/services/ai/provider-registry";

describe("AI provider registry", () => {
  it("exposes OpenAI model choices and defaults to GPT-5.5", () => {
    const openAI = getAIProviderRegistration("openai");

    expect(openAI).toBeDefined();
    expect(openAI?.defaultModel).toBe("gpt-5.5");
    expect(openAI?.models).toEqual([
      {
        id: "gpt-5.5",
        label: "GPT-5.5",
      },
      {
        id: "gpt-5.5-mini",
        label: "GPT-5.5 mini",
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
      },
    ]);
  });

  it("registers the smaller OpenAI models as valid selections", () => {
    expect(isRegisteredAIModel("openai", "gpt-5.5")).toBe(true);
    expect(isRegisteredAIModel("openai", "gpt-5.5-mini")).toBe(true);
    expect(isRegisteredAIModel("openai", "gpt-5.4-mini")).toBe(true);
  });
});
