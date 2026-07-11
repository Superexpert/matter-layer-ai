import { describe, expect, it } from "vitest";
import { testOpenAIModel } from "@/services/ai/providers/openai-setup";

describe("OpenAI model validation", () => {
  it("sends the exact selected model ID", async () => {
    let requestedModel = "";
    const result = await testOpenAIModel({
      apiKey: "test-key",
      client: { responses: {
        async create(request) { requestedModel = request.model; return { output_text: "OK" }; },
        async *stream() { yield { type: "response.completed" }; },
      } },
      model: "gpt-5.6-terra",
    });
    expect(requestedModel).toBe("gpt-5.6-terra");
    expect(result).toEqual({ message: "GPT-5.6 Terra is available for this OpenAI account.", ok: true });
  });

  it("reports model rollout access without treating the API key as invalid", async () => {
    const result = await testOpenAIModel({
      apiKey: "test-key",
      client: { responses: {
        async create() { throw Object.assign(new Error("Model unavailable"), { code: "model_not_found", status: 404 }); },
        async *stream() { yield { type: "response.completed" }; },
      } },
      model: "gpt-5.6-sol",
    });
    expect(result).toEqual({ error: "The API key is valid, but this OpenAI account does not currently have access to GPT-5.6 Sol.", ok: false });
  });
});
