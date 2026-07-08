import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  MessageParam,
  RawMessageStreamEvent,
  TextBlock,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

import type { AIRequest, AIResponse, AIStreamEvent } from "../types";
import type { AIProvider } from "./ai-provider";

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const STRUCTURED_RESPONSE_TOOL_NAME = "emit_structured_response";

const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  "sonnet-4": "claude-sonnet-4-6",
};

type AnthropicProviderConfig = {
  apiKey: string;
  client?: AnthropicMessagesClientContainer;
  model: string;
};

type AnthropicMessagesClient = {
  create(
    request: MessageCreateParamsNonStreaming,
  ): Promise<Message>;
  create(
    request: MessageCreateParamsStreaming,
  ): Promise<AsyncIterable<RawMessageStreamEvent>>;
};

type AnthropicMessagesClientContainer = {
  messages: AnthropicMessagesClient;
};

function requireConfiguredValue(name: string, value: string | undefined) {
  const configuredValue = value?.trim();

  if (!configuredValue) {
    throw new Error(`${name} is required to use the Anthropic AI provider.`);
  }

  return configuredValue;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function schemaWithoutNullableUnions(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => schemaWithoutNullableUnions(item));
  }

  if (!isObjectRecord(schema)) {
    return schema;
  }

  const normalizedSchema: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    normalizedSchema[key] = schemaWithoutNullableUnions(value);
  }

  if (Array.isArray(normalizedSchema.type)) {
    const nonNullTypes = normalizedSchema.type.filter((type) => type !== "null");

    if (nonNullTypes.length === 1) {
      normalizedSchema.type = nonNullTypes[0];
    } else if (nonNullTypes.length > 1) {
      normalizedSchema.type = nonNullTypes;
    } else {
      delete normalizedSchema.type;
    }
  }

  if (Array.isArray(normalizedSchema.enum)) {
    const nonNullEnum = normalizedSchema.enum.filter((value) => value !== null);

    if (nonNullEnum.length > 0) {
      normalizedSchema.enum = nonNullEnum;
    } else {
      delete normalizedSchema.enum;
    }
  }

  return normalizedSchema;
}

function structuredResponseToolFor(request: AIRequest): Tool {
  if (request.responseFormat?.type === "json_schema" && request.responseFormat.schema) {
    return {
      description:
        "Emit the complete JSON object requested by the extraction prompt. The JSON object must match the requested extraction schema exactly.",
      input_schema: schemaWithoutNullableUnions(
        request.responseFormat.schema,
      ) as Tool.InputSchema,
      name: STRUCTURED_RESPONSE_TOOL_NAME,
    };
  }

  return {
    description:
      "Emit the complete JSON object requested by the extraction prompt.",
    input_schema: {
      additionalProperties: true,
      type: "object",
    },
    name: STRUCTURED_RESPONSE_TOOL_NAME,
  };
}

function resolveAnthropicModel(model: string) {
  return ANTHROPIC_MODEL_ALIASES[model] ?? model;
}

function splitMessagesForAnthropic(messages: AIRequest["messages"]) {
  const systemMessages: string[] = [];
  const conversationMessages: MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemMessages.push(message.content);
      continue;
    }

    conversationMessages.push({
      content: message.content,
      role: message.role,
    });
  }

  return {
    messages: conversationMessages,
    system: systemMessages.join("\n\n") || undefined,
  };
}

function buildAnthropicRequestBase(request: AIRequest, model: string) {
  const { messages, system } = splitMessagesForAnthropic(request.messages);
  const anthropicRequest: MessageCreateParamsNonStreaming | MessageCreateParamsStreaming = {
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages,
    model,
    system,
    temperature: request.temperature,
  };

  if (request.responseFormat) {
    anthropicRequest.tools = [structuredResponseToolFor(request)];
    anthropicRequest.tool_choice = {
      name: STRUCTURED_RESPONSE_TOOL_NAME,
      type: "tool",
    };
  }

  return anthropicRequest;
}

function textFromMessage(message: Message) {
  return message.content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function structuredResponseToolUseFromMessage(message: Message) {
  return message.content.find(
    (block): block is ToolUseBlock =>
      block.type === "tool_use" && block.name === STRUCTURED_RESPONSE_TOOL_NAME,
  );
}

function contentFromMessage(message: Message, request: AIRequest) {
  if (!request.responseFormat) {
    return textFromMessage(message);
  }

  const toolUseBlock = structuredResponseToolUseFromMessage(message);

  if (!toolUseBlock) {
    throw new Error("Anthropic did not return the required structured response tool call.");
  }

  return JSON.stringify(toolUseBlock.input);
}

function isTextDeltaEvent(
  event: RawMessageStreamEvent,
): event is Extract<
  RawMessageStreamEvent,
  { type: "content_block_delta" }
> & { delta: { type: "text_delta"; text: string } } {
  return (
    event.type === "content_block_delta" &&
    event.delta.type === "text_delta" &&
    typeof event.delta.text === "string"
  );
}

function toProviderErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Anthropic stream request failed.";
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  private readonly client: AnthropicMessagesClientContainer;
  private readonly defaultModel: string;

  constructor(config: AnthropicProviderConfig) {
    this.defaultModel = resolveAnthropicModel(
      requireConfiguredValue("Anthropic model", config.model),
    );

    if (config.client) {
      this.client = config.client;
      return;
    }

    const apiKey = requireConfiguredValue(
      "Anthropic API key",
      config.apiKey,
    );

    this.client = new Anthropic({ apiKey }) as AnthropicMessagesClientContainer;
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    const model = resolveAnthropicModel(request.model?.trim() || this.defaultModel);
    const response = await this.client.messages.create({
      ...buildAnthropicRequestBase(request, model),
      stream: false,
    });

    return {
      content: contentFromMessage(response, request),
      model,
      provider: this.name,
    };
  }

  async *streamText(request: AIRequest): AsyncIterable<AIStreamEvent> {
    const model = resolveAnthropicModel(request.model?.trim() || this.defaultModel);
    let content = "";

    try {
      const stream = await this.client.messages.create({
        ...buildAnthropicRequestBase(request, model),
        stream: true,
      });

      for await (const event of stream) {
        if (!isTextDeltaEvent(event)) {
          continue;
        }

        content += event.delta.text;

        yield {
          delta: event.delta.text,
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

export { resolveAnthropicModel };
export type { AnthropicMessagesClientContainer };
