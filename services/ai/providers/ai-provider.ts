import type { AIRequest, AIResponse } from "../types";

export type AIProvider = {
  readonly name: string;
  generateText(request: AIRequest): Promise<AIResponse>;
};
