import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  MessageParam,
  RawMessageStreamEvent,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";

import type { AIRequest, AIResponse, AIStreamEvent } from "../types";
import type { AIProvider } from "./ai-provider";

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

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

  return {
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages,
    model,
    system,
    temperature: request.temperature,
  };
}

function textFromMessage(message: Message) {
  return message.content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
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
      content: textFromMessage(response),
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
