import "server-only";

import type { AIProvider } from "./providers/ai-provider";
import { createConfiguredAIProvider } from "./providers/provider-factory";
import type { AIRequest, AIResponse } from "./types";

export class AIService {
  constructor(
    private readonly provider: AIProvider = createConfiguredAIProvider(),
  ) {}

  async generateText(request: AIRequest): Promise<AIResponse> {
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new Error("AIService.generateText requires at least one message.");
    }

    for (const message of request.messages) {
      if (!message.content.trim()) {
        throw new Error("AIService.generateText does not accept empty messages.");
      }
    }

    return this.provider.generateText(request);
  }
}

export function createAIService() {
  return new AIService();
}
