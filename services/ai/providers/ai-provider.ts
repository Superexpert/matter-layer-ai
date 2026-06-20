import type { AIRequest, AIResponse, AIStreamEvent } from "../types";

export type AIProvider = {
  readonly name: string;
  generateText(request: AIRequest): Promise<AIResponse>;
  streamText(request: AIRequest): AsyncIterable<AIStreamEvent>;
};
