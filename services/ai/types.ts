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
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  responseFormat?: {
    name?: string;
    schema?: Record<string, unknown>;
    type: "json_object" | "json_schema";
  };
};

export type AIResponse = {
  content: string;
  provider: string;
  model: string;
};

export type AIStreamEvent =
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "done";
      response: AIResponse;
    }
  | {
      type: "error";
      error: string;
    };
