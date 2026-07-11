import { classifyAIProviderError } from "../provider-errors";
import { getAIProviderModel } from "../provider-registry";
import { OpenAIProvider, type OpenAIResponsesClientContainer } from "./openai-provider-core";

export type OpenAIModelTestResult =
  | { message: string; ok: true }
  | { error: string; ok: false };

function rawProviderCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown; type?: unknown }).code ?? (error as { type?: unknown }).type;
  return typeof code === "string" ? code : null;
}

function rawStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function isModelAccessError(error: unknown) {
  const code = rawProviderCode(error);
  return code === "model_not_found" || code === "model_not_available" ||
    code === "permission_denied" || (rawStatus(error) === 404 && code !== "invalid_api_key");
}

export async function testOpenAIModel(input: {
  apiKey: string;
  client?: OpenAIResponsesClientContainer;
  model: string;
}): Promise<OpenAIModelTestResult> {
  const definition = getAIProviderModel("openai", input.model);
  if (!definition) return { error: `OpenAI model ${input.model} is not supported by Matter Layer.`, ok: false };

  try {
    const provider = new OpenAIProvider(input);
    await provider.generateText({
      maxOutputTokens: 8,
      messages: [{ content: "Reply with OK.", role: "user" }],
    });
    return { message: `${definition.label} is available for this OpenAI account.`, ok: true };
  } catch (error) {
    if (isModelAccessError(error)) {
      return { error: `The API key is valid, but this OpenAI account does not currently have access to ${definition.label}.`, ok: false };
    }
    return { error: classifyAIProviderError(error, "openai").userMessage, ok: false };
  }
}
