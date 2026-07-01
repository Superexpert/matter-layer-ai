import { describe, expect, it } from "vitest";

import { OllamaProvider } from "@/services/ai/providers/ollama-provider-core";
import { createAIProviderFromSettings } from "@/services/ai/providers/provider-factory-core";
import type { AIStreamEvent } from "@/services/ai/types";

describe("OllamaProvider", () => {
  it("maps messages and returns non-streaming assistant content", async () => {
    const capturedRequests: unknown[] = [];
    const provider = new OllamaProvider({
      baseUrl: "http://matterlayer-ai.internal:11434",
      fetch: async (_url, init) => {
        capturedRequests.push(JSON.parse(String(init?.body)));

        return new Response(
          JSON.stringify({
            message: {
              content: "Generated Ollama response",
            },
          }),
        );
      },
      model: "gemma3:4b",
    });

    await expect(
      provider.generateText({
        maxOutputTokens: 256,
        messages: [
          {
            content: "You are Matter Layer.",
            role: "system",
          },
          {
            content: "Draft a summary.",
            role: "user",
          },
          {
            content: "Use a neutral tone.",
            role: "assistant",
          },
        ],
        temperature: 0.2,
      }),
    ).resolves.toEqual({
      content: "Generated Ollama response",
      model: "gemma3:4b",
      provider: "ollama",
    });

    expect(capturedRequests[0]).toEqual({
      messages: [
        {
          content: "You are Matter Layer.",
          role: "system",
        },
        {
          content: "Draft a summary.",
          role: "user",
        },
        {
          content: "Use a neutral tone.",
          role: "assistant",
        },
      ],
      model: "gemma3:4b",
      options: {
        num_predict: 256,
        temperature: 0.2,
      },
      stream: false,
    });
  });

  it("passes Ollama JSON mode for JSON object requests", async () => {
    const capturedRequests: unknown[] = [];
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      fetch: async (_url, init) => {
        capturedRequests.push(JSON.parse(String(init?.body)));

        return new Response(
          JSON.stringify({
            message: {
              content: "{\"facts\":[]}",
            },
          }),
        );
      },
      model: "gemma3:4b",
    });

    await provider.generateText({
      messages: [
        {
          content: "Return JSON.",
          role: "user",
        },
      ],
      responseFormat: {
        type: "json_object",
      },
    });

    expect(capturedRequests[0]).toMatchObject({
      format: "json",
      stream: false,
    });
  });

  it("passes Ollama schema format for schema-constrained requests", async () => {
    const capturedRequests: unknown[] = [];
    const schema = {
      properties: {
        facts: {
          type: "array",
        },
      },
      required: ["facts"],
      type: "object",
    };
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      fetch: async (_url, init) => {
        capturedRequests.push(JSON.parse(String(init?.body)));

        return new Response(
          JSON.stringify({
            message: {
              content: "{\"facts\":[]}",
            },
          }),
        );
      },
      model: "gemma3:4b",
    });

    await provider.generateText({
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
    });

    expect(capturedRequests[0]).toMatchObject({
      format: schema,
      stream: false,
    });
  });

  it("streams newline-delimited JSON chunks", async () => {
    const encoder = new TextEncoder();
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  '{"message":{"content":"Hello"},"done":false}\n{"message":{"content":" from Ollama"},"done":false}\n',
                ),
              );
              controller.enqueue(encoder.encode('{"done":true}\n'));
              controller.close();
            },
          }),
        ),
      model: "gemma3:4b",
    });
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
        delta: " from Ollama",
        type: "text-delta",
      },
      {
        response: {
          content: "Hello from Ollama",
          model: "gemma3:4b",
          provider: "ollama",
        },
        type: "done",
      },
    ]);
  });

  it("is selected from database-style settings", () => {
    const provider = createAIProviderFromSettings({
      apiKey: null,
      baseUrl: "http://localhost:11434",
      model: "gemma3:4b",
      provider: "ollama",
    });

    expect(provider.name).toBe("ollama");
  });
});
