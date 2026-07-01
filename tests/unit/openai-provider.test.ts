import { describe, expect, it } from "vitest";

import { OpenAIProvider } from "@/services/ai/providers/openai-provider-core";

describe("OpenAIProvider", () => {
  it("passes Responses structured JSON schema format when requested", async () => {
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
    const provider = new OpenAIProvider({
      apiKey: "test-openai-api-key",
      client: {
        responses: {
          async create(request) {
            capturedRequests.push(request);

            return {
              output_text: "{\"facts\":[]}",
            };
          },
          async *stream() {
            yield {
              type: "response.completed",
            };
          },
        },
      },
      model: "test-model",
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
      model: "test-model",
      store: false,
      text: {
        format: {
          name: "chronology_extraction",
          schema,
          strict: true,
          type: "json_schema",
        },
      },
    });
  });
});
