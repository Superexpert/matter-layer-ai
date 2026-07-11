import OpenAI from "openai";

import type { AIRequest, AIResponse, AIStreamEvent } from "../types";
import type { AIProvider } from "./ai-provider";
import { getAIProviderModel } from "../provider-registry";

type OpenAIProviderConfig = {
  apiKey: string;
  client?: OpenAIResponsesClientContainer;
  model: string;
};

type OpenAIResponseInputMessage = {
  content: string;
  role: "system" | "user" | "assistant";
  type: "message";
};

type OpenAIResponseRequest = {
  input: OpenAIResponseInputMessage[];
  max_output_tokens?: number;
  model: string;
  reasoning?: { effort: "none" | "low" | "medium" | "high" | "xhigh" | "max" };
  store: false;
  text?: {
    format:
      | {
          type: "json_object";
        }
      | {
          name: string;
          schema: Record<string, unknown>;
          strict: true;
          type: "json_schema";
        };
  };
  temperature?: number;
};

type OpenAIResponse = {
  output_text: string;
};

type OpenAIResponseStreamEvent =
  | {
      type: "response.output_text.delta";
      delta: string;
    }
  | {
      type: string;
      delta?: unknown;
    };

type OpenAIResponsesClient = {
  create(request: OpenAIResponseRequest): Promise<OpenAIResponse>;
  stream(request: OpenAIResponseRequest): AsyncIterable<OpenAIResponseStreamEvent>;
};

type OpenAIResponsesClientContainer = {
  responses: OpenAIResponsesClient;
};

function requireConfiguredValue(name: string, value: string | undefined) {
  const configuredValue = value?.trim();

  if (!configuredValue) {
    throw new Error(`${name} is required to use the OpenAI AI provider.`);
  }

  return configuredValue;
}

function buildOpenAIResponseRequest(
  request: AIRequest,
  model: string,
): OpenAIResponseRequest {
  const definition = getAIProviderModel("openai", model);
  const responseRequest: OpenAIResponseRequest = {
    input: request.messages.map((message) => ({
      content: message.content,
      role: message.role,
      type: "message",
    })),
    max_output_tokens: request.maxOutputTokens,
    model,
    // Required so OpenAI does not store this response as provider-side
    // application state. Abuse-monitoring retention is controlled separately
    // by provider/account policy, including any zero data retention settings.
    store: false,
  };

  if (typeof request.temperature === "number" && definition?.supportsTemperature !== false) {
    responseRequest.temperature = request.temperature;
  }

  if (request.reasoningEffort) {
    if (!definition?.supportsReasoning) {
      throw new Error(`OpenAI model ${model} does not support reasoning effort.`);
    }
    if (!definition.supportedReasoningEfforts?.includes(request.reasoningEffort)) {
      throw new Error(`OpenAI model ${model} does not support reasoning effort ${request.reasoningEffort}.`);
    }
    responseRequest.reasoning = { effort: request.reasoningEffort };
  }

  if (request.responseFormat && definition?.supportsStructuredOutput === false) {
    throw new Error(`OpenAI model ${model} does not support structured output.`);
  }

  if (request.responseFormat?.type === "json_schema" && request.responseFormat.schema) {
    responseRequest.text = {
      format: {
        name: request.responseFormat.name ?? "structured_response",
        schema: request.responseFormat.schema,
        strict: true,
        type: "json_schema",
      },
    };
  } else if (request.responseFormat?.type === "json_object") {
    responseRequest.text = {
      format: {
        type: "json_object",
      },
    };
  }

  return responseRequest;
}

function isOpenAITextDeltaEvent(
  event: OpenAIResponseStreamEvent,
): event is Extract<
  OpenAIResponseStreamEvent,
  { type: "response.output_text.delta" }
> {
  return (
    event.type === "response.output_text.delta" &&
    typeof event.delta === "string"
  );
}

function toProviderErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "OpenAI stream request failed.";
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  private readonly client: OpenAIResponsesClientContainer;
  private readonly defaultModel: string;

  constructor(config: OpenAIProviderConfig) {
    this.defaultModel = requireConfiguredValue("OpenAI model", config.model);

    if (config.client) {
      this.client = config.client;
      return;
    }

    const apiKey = requireConfiguredValue(
      "OpenAI API key",
      config.apiKey,
    );

    this.client = new OpenAI({ apiKey }) as OpenAIResponsesClientContainer;
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    const model = request.model?.trim() || this.defaultModel;
    const response = await this.client.responses.create(
      buildOpenAIResponseRequest(request, model),
    );

    return {
      content: response.output_text,
      model,
      provider: this.name,
    };
  }

  async *streamText(request: AIRequest): AsyncIterable<AIStreamEvent> {
    const model = request.model?.trim() || this.defaultModel;
    let content = "";

    try {
      const stream = this.client.responses.stream(
        buildOpenAIResponseRequest(request, model),
      );

      for await (const event of stream) {
        if (!isOpenAITextDeltaEvent(event)) {
          continue;
        }

        content += event.delta;

        yield {
          delta: event.delta,
          type: "text-delta",
        };
      }

      yield {
        response: {
          content,
          model,
          provider: this.name,
        },
        type: "done",
      };
    } catch (error) {
      yield {
        error: toProviderErrorMessage(error),
        type: "error",
      };
    }
  }
}

export type { OpenAIResponsesClientContainer };
