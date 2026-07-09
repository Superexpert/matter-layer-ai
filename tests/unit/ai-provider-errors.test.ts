import { describe, expect, it } from "vitest";

import {
  classifyAIProviderError,
  createAIProviderTimeoutError,
} from "../../services/ai/provider-errors";

function sdkError(message: string, input: { code?: string; status?: number; type?: string }) {
  return Object.assign(new Error(message), input);
}

describe("AI provider errors", () => {
  it("classifies OpenAI auth failures without exposing API keys", () => {
    const error = classifyAIProviderError(
      sdkError("Incorrect API key provided: sk-test-secret123456789", {
        code: "invalid_api_key",
        status: 401,
      }),
      "openai",
    );

    expect(error).toMatchObject({
      code: "AI_PROVIDER_AUTH_FAILED",
      provider: "openai",
      providerCode: "invalid_api_key",
      status: 401,
    });
    expect(error.message).toContain("[redacted-api-key]");
    expect(error.message).not.toContain("sk-test-secret");
  });

  it("classifies OpenAI billing and quota failures", () => {
    const error = classifyAIProviderError(
      sdkError("You exceeded your current quota, please check your plan and billing details.", {
        code: "insufficient_quota",
        status: 429,
      }),
      "openai",
    );

    expect(error.code).toBe("AI_PROVIDER_BILLING_REQUIRED");
    expect(error.userMessage).toContain("billing");
  });

  it("classifies Anthropic rate limit failures", () => {
    const error = classifyAIProviderError(
      sdkError("rate_limit_error: Too many requests", {
        status: 429,
        type: "rate_limit_error",
      }),
      "anthropic",
    );

    expect(error).toMatchObject({
      code: "AI_PROVIDER_RATE_LIMITED",
      provider: "anthropic",
      providerCode: "rate_limit_error",
      status: 429,
    });
  });

  it("classifies model and provider configuration failures", () => {
    expect(
      classifyAIProviderError(
        new Error("AI model \"foo\" is not registered for provider \"openai\"."),
      ).code,
    ).toBe("AI_PROVIDER_CONFIGURATION_FAILED");
    expect(
      classifyAIProviderError(
        sdkError("model_not_found: The requested model does not exist.", {
          status: 404,
        }),
        "anthropic",
      ).code,
    ).toBe("AI_PROVIDER_CONFIGURATION_FAILED");
  });

  it("classifies timeout and unknown request failures", () => {
    const timeoutError = createAIProviderTimeoutError({
      message: "AI provider did not return chronology extraction within 90 seconds.",
      provider: "gemma3:4b",
    });

    expect(timeoutError.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(timeoutError.userMessage).toBe(
      "The AI provider gemma3:4b did not return a response in time. Try again with fewer documents or ask an admin to check provider availability.",
    );
    expect(classifyAIProviderError(new Error("socket closed")).code).toBe(
      "AI_PROVIDER_REQUEST_FAILED",
    );
  });
});
