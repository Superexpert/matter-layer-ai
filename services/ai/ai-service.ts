import "server-only";

import type { AIProvider } from "./providers/ai-provider";
import { createConfiguredAIProvider } from "./providers/provider-factory";
import type { AIRequest, AIResponse, AIStreamEvent } from "./types";

export class AIService {
  constructor(private readonly provider: AIProvider) {}

  async generateText(request: AIRequest): Promise<AIResponse> {
    this.validateRequest(request, "generateText");

    return this.provider.generateText(request);
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
