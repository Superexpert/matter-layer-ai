import { expect, test } from "@playwright/test";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages";

import { AnthropicProvider } from "../../services/ai/providers/anthropic-provider-core";
import type { AnthropicMessagesClientContainer } from "../../services/ai/providers/anthropic-provider-core";
import { createAIProviderFromSettings } from "../../services/ai/providers/provider-factory-core";
import type { AIStreamEvent } from "../../services/ai/types";

function createAnthropicMessage(content: string, model = "claude-sonnet-4-6") {
  return {
    content: [
      {
        text: content,
        type: "text",
      },
    ],
    model,
    role: "assistant",
  } as Message;
}

function createTextDeltaEvent(delta: string) {
  return {
    delta: {
      text: delta,
      type: "text_delta",
    },
    index: 0,
    type: "content_block_delta",
  } as RawMessageStreamEvent;
}

function createProvider() {
  const capturedRequests: Array<
    MessageCreateParamsNonStreaming | MessageCreateParamsStreaming
  > = [];
  function createMessage(
    request: MessageCreateParamsNonStreaming,
  ): Promise<Message>;
  function createMessage(
    request: MessageCreateParamsStreaming,
  ): Promise<AsyncIterable<RawMessageStreamEvent>>;
  async function createMessage(
    request: MessageCreateParamsNonStreaming | MessageCreateParamsStreaming,
  ): Promise<Message | AsyncIterable<RawMessageStreamEvent>> {
    capturedRequests.push(request);

    if (request.stream) {
      return (async function* streamEvents() {
        yield createTextDeltaEvent("Hello");
        yield createTextDeltaEvent(" from Claude");
      })();
    }

    return createAnthropicMessage("Generated Anthropic response");
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

test("AnthropicProvider.generateText maps system messages and returns provider-neutral text", async () => {
  const { capturedRequests, provider } = createProvider();

  await expect(
    provider.generateText({
      messages: [
        {
          content: "You are Matter Layer.",
          role: "system",
        },
        {
          content: "Keep responses concise.",
          role: "system",
        },
        {
          content: "Draft a summary.",
          role: "user",
        },
        {
          content: "What tone should I use?",
          role: "assistant",
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 512,
    }),
  ).resolves.toEqual({
    content: "Generated Anthropic response",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
  });

  expect(capturedRequests[0]).toMatchObject({
    max_tokens: 512,
    messages: [
      {
        content: "Draft a summary.",
        role: "user",
      },
      {
        content: "What tone should I use?",
        role: "assistant",
      },
    ],
    model: "claude-sonnet-4-6",
    stream: false,
    system: "You are Matter Layer.\n\nKeep responses concise.",
    temperature: 0.2,
  });
});

test("AnthropicProvider.streamText yields text deltas and final response", async () => {
  const { provider } = createProvider();
  const events: AIStreamEvent[] = [];

  for await (const event of provider.streamText({
    messages: [
      {
        content: "Draft a summary.",
        role: "user",
      },
    ],
  })) {
    events.push(event);
  }

  expect(events).toEqual([
    {
      delta: "Hello",
      type: "text-delta",
    },
    {
      delta: " from Claude",
      type: "text-delta",
    },
    {
      response: {
        content: "Hello from Claude",
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      },
      type: "done",
    },
  ]);

  const accumulatedText = events
    .filter((event) => event.type === "text-delta")
    .map((event) => event.delta)
    .join("");
  const doneEvent = events.find((event) => event.type === "done");

  expect(doneEvent?.type).toBe("done");
  expect(doneEvent?.response.content).toBe(accumulatedText);
});

test("provider selection returns Anthropic from database-style settings", () => {
  const provider = createAIProviderFromSettings({
    apiKey: "test-anthropic-api-key",
    baseUrl: null,
    model: "sonnet-4",
    provider: "anthropic",
  });

  expect(provider.name).toBe("anthropic");
});
