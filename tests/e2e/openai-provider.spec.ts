import { expect, test } from "@playwright/test";

import { OpenAIProvider } from "../../services/ai/providers/openai-provider-core";
import type { AIStreamEvent } from "../../services/ai/types";

function createProvider() {
  return new OpenAIProvider({
    client: {
      responses: {
        async create() {
          return {
            output_text: "Generated response",
          };
        },
        async *stream() {
          yield {
            delta: "Hello",
            type: "response.output_text.delta",
          };
          yield {
            delta: " world",
            type: "response.output_text.delta",
          };
          yield {
            type: "response.completed",
          };
        },
      },
    },
    apiKey: "test-openai-api-key",
    model: "test-model",
  });
}

test("OpenAIProvider.generateText returns provider-neutral text", async () => {
  const provider = createProvider();

  await expect(
    provider.generateText({
      messages: [
        {
          content: "Draft a summary.",
          role: "user",
        },
      ],
    }),
  ).resolves.toEqual({
    content: "Generated response",
    model: "test-model",
    provider: "openai",
  });
});

test("OpenAIProvider.streamText yields text deltas and final response", async () => {
  const provider = createProvider();
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
      delta: " world",
      type: "text-delta",
    },
    {
      response: {
        content: "Hello world",
        model: "test-model",
        provider: "openai",
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
