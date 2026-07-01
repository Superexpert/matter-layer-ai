import { normalizeOllamaBaseUrl } from "./ollama-base-url";

type FetchLike = typeof fetch;

type OllamaTagsResponse = {
  models?: Array<{
    name?: unknown;
  }>;
};

type OllamaChatResponse = {
  message?: {
    content?: unknown;
  };
};

export type OllamaAvailabilityResult =
  | {
      available: true;
      baseUrl: string;
      models: string[];
    }
  | {
      available: false;
      baseUrl: string;
      error: string;
    };

export type OllamaModelTestResult =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export function getPreferredOllamaModel(models: string[]) {
  return (
    models.find((model) => model.toLowerCase().includes("gemma")) ??
    models[0] ??
    ""
  );
}

function ollamaUnavailableMessage(baseUrl: string) {
  return `Matter Layer could not reach Ollama at ${baseUrl}. Make sure Ollama is installed and running on the Matter Layer server.`;
}

function ollamaTestFailureMessage(baseUrl: string) {
  return `Matter Layer could not confirm that Ollama can use the selected model at ${baseUrl}. Make sure Ollama is running and the selected model is installed.`;
}

function toInstalledModelNames(response: OllamaTagsResponse) {
  if (!Array.isArray(response.models)) {
    return [];
  }

  return response.models
    .map((model) => (typeof model.name === "string" ? model.name.trim() : ""))
    .filter(Boolean);
}

export async function checkOllamaAvailability(
  baseUrlInput: string,
  fetchImpl: FetchLike = fetch,
): Promise<OllamaAvailabilityResult> {
  const baseUrl = normalizeOllamaBaseUrl(baseUrlInput);

  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        available: false,
        baseUrl,
        error: ollamaUnavailableMessage(baseUrl),
      };
    }

    const body = (await response.json()) as OllamaTagsResponse;

    return {
      available: true,
      baseUrl,
      models: toInstalledModelNames(body),
    };
  } catch {
    return {
      available: false,
      baseUrl,
      error: ollamaUnavailableMessage(baseUrl),
    };
  }
}

export async function testOllamaModel(
  input: {
    baseUrl: string;
    model: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<OllamaModelTestResult> {
  const baseUrl = normalizeOllamaBaseUrl(input.baseUrl);
  const model = input.model.trim();

  if (!model) {
    return {
      error: "Select an installed Ollama model before testing.",
      ok: false,
    };
  }

  try {
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      body: JSON.stringify({
        messages: [
          {
            content: "Respond with exactly one word: ready",
            role: "user",
          },
        ],
        model,
        stream: false,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return {
        error: ollamaTestFailureMessage(baseUrl),
        ok: false,
      };
    }

    const body = (await response.json()) as OllamaChatResponse;
    const content =
      typeof body.message?.content === "string" ? body.message.content.trim() : "";

    if (!content) {
      return {
        error: ollamaTestFailureMessage(baseUrl),
        ok: false,
      };
    }

    return {
      message: "Ollama is running and the selected model responded.",
      ok: true,
    };
  } catch {
    return {
      error: ollamaTestFailureMessage(baseUrl),
      ok: false,
    };
  }
}

