export type AIMessageRole = "system" | "user" | "assistant";

export type AIMessage = {
  role: AIMessageRole;
  content: string;
};

export type AIRequest = {
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type AIResponse = {
  content: string;
  provider: string;
  model: string;
};
