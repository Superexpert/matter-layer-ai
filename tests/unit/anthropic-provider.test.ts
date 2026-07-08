import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it } from "vitest";

import {
  AnthropicProvider,
  type AnthropicMessagesClientContainer,
} from "@/services/ai/providers/anthropic-provider-core";

function createProvider(response: Message) {
  const capturedRequests: Array<
    MessageCreateParamsNonStreaming | MessageCreateParamsStreaming
  > = [];
  function createMessage(
    request: MessageCreateParamsNonStreaming,
  ): Promise<Message>;
  function createMessage(
    request: MessageCreateParamsStreaming,
  ): Promise<AsyncIterable<never>>;
  async function createMessage(
    request: MessageCreateParamsNonStreaming | MessageCreateParamsStreaming,
  ): Promise<Message | AsyncIterable<never>> {
    capturedRequests.push(request);

    if (request.stream) {
      return (async function* streamEvents() {})();
    }

    return response;
  }

  const client: AnthropicMessagesClientContainer = {
    messages: {
      create: createMessage,
    },
  };

  return {
    capturedRequests,
    provider: new AnthropicProvider({
      apiKey: "test-anthropic-api-key",
      client,
      model: "sonnet-4",
    }),
  };
}

function anthropicMessage(content: Message["content"]): Message {
  return {
    content,
    id: "msg_test",
    model: "claude-sonnet-4-6",
    role: "assistant",
    stop_details: null,
    stop_reason: "tool_use",
    type: "message",
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 10,
      output_tokens: 10,
      server_tool_use: null,
    },
  } as Message;
}

describe("AnthropicProvider", () => {
  it("forces an Anthropic structured response tool call for JSON schema requests", async () => {
    const schema = {
      additionalProperties: false,
      properties: {
        facts: {
          items: {
            additionalProperties: false,
            properties: {
              confidence: {
                enum: ["high", "medium", "low", null],
                type: ["string", "null"],
              },
            },
            required: ["confidence"],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["facts"],
      type: "object",
    };
    const { capturedRequests, provider } = createProvider(
      anthropicMessage([
        {
          caller: {
            type: "direct",
          },
          id: "toolu_test",
          input: {
            facts: [],
          },
          name: "emit_structured_response",
          type: "tool_use",
        },
      ]),
    );

    await expect(
      provider.generateText({
        messages: [
          {
            content: "Return JSON.",
            role: "user",
          },
        ],
        responseFormat: {
          name: "chronology_extraction",
          schema,
          type: "json_schema",
        },
      }),
    ).resolves.toEqual({
      content: "{\"facts\":[]}",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
    });

    expect(capturedRequests[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      stream: false,
      tool_choice: {
        name: "emit_structured_response",
        type: "tool",
      },
      tools: [
        {
          input_schema: {
            properties: {
              facts: {
                items: {
                  properties: {
                    confidence: {
                      enum: ["high", "medium", "low"],
                      type: "string",
                    },
                  },
                },
              },
            },
            required: ["facts"],
            type: "object",
          },
          name: "emit_structured_response",
        },
      ],
    });
    expect(capturedRequests[0]).not.toHaveProperty("output_config");
  });

  it("removes nullable unions from the Anthropic tool schema while preserving fields", async () => {
    const schema = {
      properties: Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [
          `nullableField${index}`,
          {
            type: ["string", "null"],
          },
        ]),
      ),
      type: "object",
    };
    const { capturedRequests, provider } = createProvider(
      anthropicMessage([
        {
          caller: {
            type: "direct",
          },
          id: "toolu_test",
          input: {
            nullableField0: null,
          },
          name: "emit_structured_response",
          type: "tool_use",
        },
      ]),
    );

    await provider.generateText({
      messages: [
        {
          content: "Return JSON.",
          role: "user",
        },
      ],
      responseFormat: {
        name: "large_nullable_schema",
        schema,
        type: "json_schema",
      },
    });

    expect(capturedRequests[0]).toMatchObject({
      stream: false,
      tools: [
        {
          input_schema: {
            properties: {
              nullableField0: {
                type: "string",
              },
              nullableField32: {
                type: "string",
              },
            },
            type: "object",
          },
        },
      ],
    });
    expect(JSON.stringify(capturedRequests[0])).not.toContain("[\"string\",\"null\"]");
  });

  it("fails fast when a structured request does not produce the required tool call", async () => {
    const { provider } = createProvider(
      anthropicMessage([
        {
          citations: null,
          text: "Here is some JSON: {\"facts\":[]}",
          type: "text",
        },
      ]),
    );

    await expect(
      provider.generateText({
        messages: [
          {
            content: "Return JSON.",
            role: "user",
          },
        ],
        responseFormat: {
          schema: {
            properties: {
              facts: {
                type: "array",
              },
            },
            required: ["facts"],
            type: "object",
          },
          type: "json_schema",
        },
      }),
    ).rejects.toThrow(
      "Anthropic did not return the required structured response tool call.",
    );
  });
});
