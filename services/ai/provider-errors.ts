export const AI_PROVIDER_ERROR_CODES = [
  "AI_PROVIDER_AUTH_FAILED",
  "AI_PROVIDER_BILLING_REQUIRED",
  "AI_PROVIDER_CONFIGURATION_FAILED",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_REQUEST_FAILED",
  "AI_PROVIDER_TIMEOUT",
] as const;

export type AIProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number];

type AIProviderErrorInput = {
  code: AIProviderErrorCode;
  message: string;
  provider?: string | null;
  providerCode?: string | null;
  status?: number | null;
  userMessage: string;
};

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly provider: string | null;
  readonly providerCode: string | null;
  readonly status: number | null;
  readonly userMessage: string;

  constructor(input: AIProviderErrorInput) {
    super(input.message);
    this.name = "AIProviderError";
    this.code = input.code;
    this.provider = input.provider ?? null;
    this.providerCode = input.providerCode ?? null;
    this.status = input.status ?? null;
    this.userMessage = input.userMessage;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rawErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "AI provider request failed.";
}

function sanitizeProviderMessage(message: string) {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-api-key]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "[redacted-api-key]")
    .slice(0, 1000);
}

function numericStatus(error: unknown) {
  if (!isObjectRecord(error)) {
    return null;
  }

  const status = error.status ?? error.statusCode;

  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function providerCode(error: unknown) {
  if (!isObjectRecord(error)) {
    return null;
  }

  const code = error.code ?? error.type ?? error.errorType;

  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function lowerDiagnosticText(input: {
  message: string;
  providerCode: string | null;
}) {
  return [input.message, input.providerCode].filter(Boolean).join(" ").toLowerCase();
}

function classifiedCode(input: {
  message: string;
  providerCode: string | null;
  status: number | null;
}): AIProviderErrorCode {
  const diagnosticText = lowerDiagnosticText(input);

  if (
    input.status === 401 ||
    input.status === 403 ||
    diagnosticText.includes("invalid api key") ||
    diagnosticText.includes("incorrect api key") ||
    (diagnosticText.includes("api key") && diagnosticText.includes("invalid")) ||
    diagnosticText.includes("authentication") ||
    diagnosticText.includes("unauthorized") ||
    diagnosticText.includes("permission denied")
  ) {
    return "AI_PROVIDER_AUTH_FAILED";
  }

  if (
    input.status === 402 ||
    diagnosticText.includes("insufficient_quota") ||
    diagnosticText.includes("insufficient quota") ||
    diagnosticText.includes("quota exceeded") ||
    diagnosticText.includes("credit") ||
    diagnosticText.includes("billing") ||
    diagnosticText.includes("payment") ||
    diagnosticText.includes("balance") ||
    diagnosticText.includes("recharge")
  ) {
    return "AI_PROVIDER_BILLING_REQUIRED";
  }

  if (
    input.status === 429 ||
    diagnosticText.includes("rate_limit") ||
    diagnosticText.includes("rate limit") ||
    diagnosticText.includes("too many requests") ||
    diagnosticText.includes("overloaded")
  ) {
    return "AI_PROVIDER_RATE_LIMITED";
  }

  if (
    diagnosticText.includes("timed out") ||
    diagnosticText.includes("timeout") ||
    diagnosticText.includes("did not return") ||
    diagnosticText.includes("abort")
  ) {
    return "AI_PROVIDER_TIMEOUT";
  }

  if (
    input.status === 400 ||
    input.status === 404 ||
    (diagnosticText.includes("model") && diagnosticText.includes("not")) ||
    diagnosticText.includes("unsupported model") ||
    diagnosticText.includes("not configured") ||
    diagnosticText.includes("not registered") ||
    diagnosticText.includes("provider settings") ||
    diagnosticText.includes("invalid request")
  ) {
    return "AI_PROVIDER_CONFIGURATION_FAILED";
  }

  return "AI_PROVIDER_REQUEST_FAILED";
}

function userMessageForCode(
  code: AIProviderErrorCode,
  provider?: string | null,
) {
  if (code === "AI_PROVIDER_AUTH_FAILED") {
    return "Matter Layer could not reach the configured AI provider because the saved API key or provider access is not valid.";
  }

  if (code === "AI_PROVIDER_BILLING_REQUIRED") {
    return "The configured AI provider account appears to need billing, credits, or quota attention before Matter Layer can continue.";
  }

  if (code === "AI_PROVIDER_RATE_LIMITED") {
    return "The configured AI provider is rate limiting Matter Layer. Try again shortly or ask an admin to review provider limits.";
  }

  if (code === "AI_PROVIDER_CONFIGURATION_FAILED") {
    return "Matter Layer could not use the configured AI provider model or settings. Ask an admin to review the AI provider configuration.";
  }

  if (code === "AI_PROVIDER_TIMEOUT") {
    const providerLabel = provider?.trim();

    return providerLabel
      ? `The AI provider ${providerLabel} did not return a response in time. Try again with fewer documents or ask an admin to check provider availability.`
      : "The AI provider did not return a response in time. Try again with fewer documents or ask an admin to check provider availability.";
  }

  return "Matter Layer could not complete the AI provider request. Try again or ask an admin to review the configured AI provider.";
}

export function isAIProviderError(error: unknown): error is AIProviderError {
  return error instanceof AIProviderError;
}

export function classifyAIProviderError(
  error: unknown,
  provider?: string | null,
): AIProviderError {
  if (isAIProviderError(error)) {
    return error;
  }

  const message = sanitizeProviderMessage(rawErrorMessage(error));
  const status = numericStatus(error);
  const code = providerCode(error);
  const classified = classifiedCode({
    message,
    providerCode: code,
    status,
  });

  return new AIProviderError({
    code: classified,
    message,
    provider,
    providerCode: code,
    status,
    userMessage: userMessageForCode(classified, provider),
  });
}

export function createAIProviderTimeoutError(input: {
  message: string;
  provider?: string | null;
}) {
  return new AIProviderError({
    code: "AI_PROVIDER_TIMEOUT",
    message: sanitizeProviderMessage(input.message),
    provider: input.provider,
    userMessage: userMessageForCode("AI_PROVIDER_TIMEOUT", input.provider),
  });
}
