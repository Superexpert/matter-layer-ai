import "server-only";

import OpenAI from "openai";

import type { AIRequest, AIResponse } from "../types";
import type { AIProvider } from "./ai-provider";

type OpenAIProviderConfig = {
  apiKey?: string;
  model?: string;
};

function requireConfiguredValue(name: string, value: string | undefined) {
  const configuredValue = value?.trim();

  if (!configuredValue) {
    throw new Error(`${name} is required to use the OpenAI AI provider.`);
  }

  return configuredValue;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(config: OpenAIProviderConfig = {}) {
    const apiKey = requireConfiguredValue(
      "OPENAI_API_KEY",
      config.apiKey ?? process.env.OPENAI_API_KEY,
    );

    this.defaultModel = requireConfiguredValue(
      "AI_OPENAI_MODEL",
      config.model ?? process.env.AI_OPENAI_MODEL,
    );

    this.client = new OpenAI({ apiKey });
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    const model = request.model?.trim() || this.defaultModel;

    const response = await this.client.responses.create({
      input: request.messages.map((message) => ({
        content: message.content,
        role: message.role,
        type: "message" as const,
      })),
      max_output_tokens: request.maxOutputTokens,
      model,
      // Required so OpenAI does not store this response as provider-side
      // application state. Abuse-monitoring retention is controlled separately
      // by provider/account policy, including any zero data retention settings.
      store: false,
      temperature: request.temperature,
    });

    return {
      content: response.output_text,
      model,
      provider: this.name,
    };
  }
}
