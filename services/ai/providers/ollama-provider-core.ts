import type { AIRequest, AIResponse, AIStreamEvent } from "../types";
import type { AIProvider } from "./ai-provider";
import { normalizeOllamaBaseUrl } from "./ollama-base-url";

type FetchLike = typeof fetch;

type OllamaProviderConfig = {
  baseUrl: string;
  fetch?: FetchLike;
  model: string;
};

type OllamaChatMessage = {
  content: string;
  role: "system" | "user" | "assistant";
};

type OllamaChatRequest = {
  format?: "json" | Record<string, unknown>;
  messages: OllamaChatMessage[];
  model: string;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
  stream: boolean;
};

type OllamaChatResponse = {
  message?: {
    content?: unknown;
  };
};

type OllamaStreamChunk = {
  done?: unknown;
  error?: unknown;
  message?: {
    content?: unknown;
  };
};

function requireConfiguredValue(name: string, value: string | undefined) {
  const configuredValue = value?.trim();

  if (!configuredValue) {
    throw new Error(`${name} is required to use the Ollama AI provider.`);
  }

  return configuredValue;
}

function buildOllamaChatRequest(
  request: AIRequest,
  model: string,
  stream: boolean,
): OllamaChatRequest {
  const options: OllamaChatRequest["options"] = {};

  if (typeof request.temperature === "number") {
    options.temperature = request.temperature;
  }

  if (typeof request.maxOutputTokens === "number") {
    options.num_predict = request.maxOutputTokens;
  }

  const chatRequest: OllamaChatRequest = {
    messages: request.messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
    model,
    options: Object.keys(options).length > 0 ? options : undefined,
    stream,
  };

  if (request.responseFormat?.type === "json_schema" && request.responseFormat.schema) {
    chatRequest.format = request.responseFormat.schema;
  } else if (request.responseFormat?.type === "json_object") {
    chatRequest.format = "json";
  }

  return chatRequest;
}

function ollamaChatUrl(baseUrl: string) {
  return `${baseUrl}/api/chat`;
}

async function readErrorResponse(response: Response) {
  try {
    const text = await response.text();

    return text.trim() || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function toProviderErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Ollama stream request failed.";
}

function parseStreamLine(line: string): OllamaStreamChunk | null {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return null;
  }

  return JSON.parse(trimmedLine) as OllamaStreamChunk;
}

export async function* parseOllamaStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const chunk = parseStreamLine(line);

      if (!chunk) {
        continue;
      }

      if (typeof chunk.error === "string" && chunk.error.trim()) {
        throw new Error(chunk.error);
      }

      if (typeof chunk.message?.content === "string" && chunk.message.content) {
        yield chunk.message.content;
      }
    }
  }

  buffer += decoder.decode();
  const finalChunk = parseStreamLine(buffer);

  if (finalChunk) {
    if (typeof finalChunk.error === "string" && finalChunk.error.trim()) {
      throw new Error(finalChunk.error);
    }

    if (
      typeof finalChunk.message?.content === "string" &&
      finalChunk.message.content
    ) {
      yield finalChunk.message.content;
    }
  }
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: OllamaProviderConfig) {
    this.baseUrl = normalizeOllamaBaseUrl(config.baseUrl);
    this.defaultModel = requireConfiguredValue("Ollama model", config.model);
    this.fetchImpl = config.fetch ?? fetch;
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    const model = request.model?.trim() || this.defaultModel;
    const response = await this.fetchImpl(ollamaChatUrl(this.baseUrl), {
      body: JSON.stringify(buildOllamaChatRequest(request, model, false)),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    const body = (await response.json()) as OllamaChatResponse;
    const content =
      typeof body.message?.content === "string" ? body.message.content : "";

    return {
      content,
      model,
      provider: this.name,
    };
  }

  async *streamText(request: AIRequest): AsyncIterable<AIStreamEvent> {
    const model = request.model?.trim() || this.defaultModel;
    let content = "";

    try {
      const response = await this.fetchImpl(ollamaChatUrl(this.baseUrl), {
        body: JSON.stringify(buildOllamaChatRequest(request, model, true)),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      if (!response.body) {
        throw new Error("Ollama did not return a streaming response body.");
      }

      for await (const delta of parseOllamaStream(response.body)) {
        content += delta;

        yield {
          delta,
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

export type { OllamaProviderConfig };
