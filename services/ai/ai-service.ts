import "server-only";

import type { AIProvider } from "./providers/ai-provider";
import { createConfiguredAIProvider } from "./providers/provider-factory";
import type { AIRequest, AIResponse, AIStreamEvent } from "./types";
import { classifyAIProviderError } from "./provider-errors";

export class AIService {
  constructor(private readonly provider: AIProvider) {}

  async generateText(request: AIRequest): Promise<AIResponse> {
    this.validateRequest(request, "generateText");
    const startedAt = Date.now();
    const requestMetadata = {
      maxOutputTokens: request.maxOutputTokens ?? null,
      messageCount: request.messages.length,
      model: request.model?.trim() || null,
      provider: this.provider.name,
      promptCharacterCount: request.messages.reduce(
        (total, message) => total + message.content.length,
        0,
      ),
      temperature: request.temperature ?? null,
    };

    try {
      console.info("[ai:generateText] request started", requestMetadata);
      const response = await this.provider.generateText(request);

      console.info("[ai:generateText] request completed", {
        ...requestMetadata,
        durationMs: Date.now() - startedAt,
        responseCharacterCount: response.content.length,
        responseModel: response.model,
        responseProvider: response.provider,
      });

      return response;
    } catch (error) {
      const providerError = classifyAIProviderError(error, this.provider.name);

      console.error("[ai:generateText] request failed", {
        ...requestMetadata,
        durationMs: Date.now() - startedAt,
        errorCode: providerError.code,
        errorMessage: providerError.message,
        errorProvider: providerError.provider,
        errorStatus: providerError.status,
        errorUserMessage: providerError.userMessage,
      });

      throw providerError;
    }
  }

  async *streamText(request: AIRequest): AsyncIterable<AIStreamEvent> {
    this.validateRequest(request, "streamText");

    yield* this.provider.streamText(request);
  }

  private validateRequest(
    request: AIRequest,
    methodName: "generateText" | "streamText",
  ) {
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new Error(`AIService.${methodName} requires at least one message.`);
    }

    for (const message of request.messages) {
      if (!message.content.trim()) {
        throw new Error(
          `AIService.${methodName} does not accept empty messages.`,
        );
      }
    }
  }
}

export async function createAIService() {
  return new AIService(await createConfiguredAIProvider());
}
