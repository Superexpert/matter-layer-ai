import {
  classifyAIProviderError,
  createAIProviderTimeoutError,
} from "@/services/ai/provider-errors";

import { JsonModelOutputParseError } from "./json-output";
import { createMarkdownWindows } from "./markdown-windowing";
import type {
  ExtractionModelParseResult,
  ExtractionProfile,
  ExtractionProfileContext,
  ExtractionProfileRunResult,
} from "./types";

type GenerateTextResult = Awaited<
  ReturnType<ExtractionProfileContext["aiService"]["generateText"]>
>;

export const DEFAULT_AI_TIMEOUTS_MS = {
  anthropic: 120_000,
  ollama: 300_000,
  openai: 120_000,
} as const;

function conciseError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 1000);
  }

  return "Extraction failed.";
}

export function defaultAIWindowTimeoutMs(providerType?: string | null) {
  const rawValue = process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_TIMEOUT_MS;

  if (!rawValue) {
    if (providerType === "ollama") {
      return DEFAULT_AI_TIMEOUTS_MS.ollama;
    }

    if (providerType === "anthropic") {
      return DEFAULT_AI_TIMEOUTS_MS.anthropic;
    }

    return DEFAULT_AI_TIMEOUTS_MS.openai;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `MATTER_LAYER_EXTRACTION_AI_WINDOW_TIMEOUT_MS must be a positive integer: ${rawValue}`,
    );
  }

  return parsedValue;
}

function defaultAIHeartbeatMs() {
  const rawValue = process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_HEARTBEAT_MS;

  if (!rawValue) {
    return 10_000;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `MATTER_LAYER_EXTRACTION_AI_WINDOW_HEARTBEAT_MS must be a positive integer: ${rawValue}`,
    );
  }

  return parsedValue;
}

async function withAIWindowMonitoring(input: {
  heartbeatMs: number;
  onHeartbeat: (elapsedMs: number) => Promise<void> | void;
  profileLabel: string;
  providerId?: string | null;
  providerModel?: string | null;
  providerType?: string | null;
  queuedElapsedMs?: number;
  run: () => Promise<GenerateTextResult>;
  timeoutMs: number;
  windowDescription: Record<string, unknown>;
}) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  const startedAt = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const elapsedMs = Date.now() - startedAt;

        console.error("[extraction:ai-window] AI provider call timed out", {
          ...input.windowDescription,
          elapsedMs,
          profile: input.profileLabel,
          providerId: input.providerId ?? null,
          providerModel: input.providerModel ?? null,
          providerType: input.providerType ?? null,
          queuedElapsedMs: input.queuedElapsedMs ?? null,
          timeoutMs: input.timeoutMs,
        });
        reject(
          createAIProviderTimeoutError({
            message:
              `AI provider did not return ${input.profileLabel} extraction within ${Math.round(input.timeoutMs / 1000)} seconds.`,
            provider: input.providerModel ?? input.providerId,
          }),
        );
      }, input.timeoutMs);
      heartbeatId = setInterval(() => {
        const elapsedMs = Date.now() - startedAt;

        console.info("[extraction:ai-window] still waiting for AI provider", {
          ...input.windowDescription,
          elapsedMs,
          heartbeatMs: input.heartbeatMs,
          profile: input.profileLabel,
          providerId: input.providerId ?? null,
          providerModel: input.providerModel ?? null,
          providerType: input.providerType ?? null,
          queuedElapsedMs: input.queuedElapsedMs ?? null,
          timeoutMs: input.timeoutMs,
        });
        void Promise.resolve(input.onHeartbeat(elapsedMs)).catch((error: unknown) => {
          console.error("Extraction heartbeat failed", {
            error,
          });
        });
      }, input.heartbeatMs);
    });
    const providerPromise = Promise.resolve().then(input.run);

    return await Promise.race([providerPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (heartbeatId) {
      clearInterval(heartbeatId);
    }
  }
}

function statusForResult(input: {
  failedWindowCount: number;
  itemCount: number;
  totalWindowCount: number;
}) {
  if (input.totalWindowCount === 0) {
    return "FAILED" as const;
  }

  if (input.failedWindowCount === 0) {
    return "COMPLETED" as const;
  }

  if (input.itemCount > 0 || input.failedWindowCount < input.totalWindowCount) {
    return "PARTIAL_FAILED" as const;
  }

  return "FAILED" as const;
}

function mergeItemCounts(
  aggregate: Record<string, number>,
  next: Record<string, number> | undefined,
) {
  const itemCounts = {
    ...aggregate,
  };

  for (const [itemType, count] of Object.entries(next ?? {})) {
    itemCounts[itemType] = (itemCounts[itemType] ?? 0) + count;
  }

  return itemCounts;
}

function parseWindowOutput<TItem>(
  profile: ExtractionProfile<TItem>,
  content: string,
  window: Parameters<ExtractionProfile<TItem>["buildUserPrompt"]>[0],
): ExtractionModelParseResult<TItem> {
  return profile.parseModelOutput(content, {
    window,
  });
}

function repairPrompt(input: {
  invalidContent: string;
  parseError: JsonModelOutputParseError;
  profile: ExtractionProfile<unknown>;
}) {
  return [
    "Return only valid JSON.",
    "Do not include Markdown.",
    "Do not include explanation.",
    "Match the required schema exactly.",
    "",
    "Required schema:",
    input.profile.jsonRepairInstructions ?? "Return the exact JSON shape requested by the extraction prompt.",
    "",
    "The previous response could not be parsed as JSON.",
    `Parse diagnostics: ${JSON.stringify(input.parseError.diagnostics)}`,
    "",
    "Previous response:",
    input.invalidContent.slice(0, 20_000),
  ].join("\n");
}

function truncatedModelResponse(content: string | null | undefined) {
  if (!content) {
    return content ?? null;
  }

  const maxLength = 4000;

  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}... [truncated ${content.length - maxLength} chars]`;
}

export async function runExtractionProfile<TItem>(
  profile: ExtractionProfile<TItem>,
  context: ExtractionProfileContext,
): Promise<ExtractionProfileRunResult<TItem>> {
  const createWindows = profile.createWindows ?? createMarkdownWindows;
  const windows = context.readyDocuments.flatMap((document) =>
    createWindows({
      documentId: document.id,
      fileName: document.fileName,
      markdown: document.markdown,
    }),
  );
  const items: TItem[] = [];
  const errors: string[] = [];
  const warnings: ExtractionProfileRunResult<TItem>["warnings"] = [];
  const providerErrors: ReturnType<typeof classifyAIProviderError>[] = [];
  const errorCodes: string[] = [];
  const errorKinds: Array<"json_parse" | "provider" | "schema_validation"> = [];
  let itemCountsByType: Record<string, number> = {};
  let provider: string | null = null;
  let model: string | null = null;
  const aiCallTimeoutMs = context.aiCallTimeoutMs ??
    defaultAIWindowTimeoutMs(context.aiProvider?.providerType);
  const aiHeartbeatMs = context.aiHeartbeatMs ?? defaultAIHeartbeatMs();
  const providerId = context.aiProvider?.providerId ?? null;
  const providerModel = context.aiProvider?.model ?? null;
  const providerType = context.aiProvider?.providerType ?? null;
  const queuedElapsedMs = context.queuedElapsedMs;

  for (const window of windows) {
    const userPrompt = profile.buildUserPrompt(window);
    const promptCharacterCount = profile.systemPrompt.length + userPrompt.length;
    const windowDescription = {
      documentId: window.documentId,
      fileName: window.fileName,
      markdownCharacterCount: window.markdown.length,
      pageEnd: window.pageEnd,
      pageStart: window.pageStart,
      profile: profile.id,
      promptCharacterCount,
      providerId,
      providerModel,
      providerType,
      queuedElapsedMs,
      timeoutMs: aiCallTimeoutMs,
      workflowRunId: context.workflowRunId,
      workflowStepId: context.workflowStepId,
      windowCount: windows.length,
      windowIndex: window.windowIndex + 1,
    };

    console.info("[extraction:ai-window] extraction window started", windowDescription);
    await context.onWindowProgress?.({
      documentId: window.documentId,
      failedWindowCount: errors.length,
      fileName: window.fileName,
      markdownCharacterCount: window.markdown.length,
      pageEnd: window.pageEnd,
      pageStart: window.pageStart,
      promptCharacterCount,
      providerId,
      providerModel,
      providerType,
      queuedElapsedMs,
      status: "started",
      timeoutMs: aiCallTimeoutMs,
      windowCount: windows.length,
      windowIndex: window.windowIndex + 1,
    });

    let failureKindHint: "provider" | "schema_validation" = "provider";

    let response: GenerateTextResult | null = null;

    try {
      response = await withAIWindowMonitoring({
        heartbeatMs: aiHeartbeatMs,
        onHeartbeat: (elapsedMs) =>
          context.onWindowProgress?.({
            documentId: window.documentId,
            elapsedMs,
            failedWindowCount: errors.length,
            fileName: window.fileName,
            markdownCharacterCount: window.markdown.length,
            pageEnd: window.pageEnd,
            pageStart: window.pageStart,
            promptCharacterCount,
            providerId,
            providerModel,
            providerType,
            queuedElapsedMs,
            status: "waiting",
            timeoutMs: aiCallTimeoutMs,
            windowCount: windows.length,
            windowIndex: window.windowIndex + 1,
          }),
        profileLabel: profile.id,
        providerId,
        providerModel,
        providerType,
        queuedElapsedMs,
        run: () =>
          context.aiService.generateText({
            maxOutputTokens: profile.maxOutputTokens ?? 6000,
            messages: [
              {
                content: profile.systemPrompt,
                role: "system",
              },
              {
                content: userPrompt,
                role: "user",
              },
            ],
            responseFormat: profile.responseFormat,
          }),
        timeoutMs: aiCallTimeoutMs,
        windowDescription,
      });
      let parsed: ExtractionModelParseResult<TItem>;

      try {
        failureKindHint = "schema_validation";
        parsed = parseWindowOutput(profile, response.content, window);
      } catch (error) {
        if (!(error instanceof JsonModelOutputParseError)) {
          console.error("[extraction:ai-window] model output schema validation failed", {
            ...windowDescription,
            documentId: window.documentId,
            fileName: window.fileName,
            errorMessage: conciseError(error),
            model: response.model,
            provider: response.provider,
            rawModelResponse: truncatedModelResponse(response.content),
          });
          throw error;
        }

        console.error("[extraction:ai-window] model output JSON parse failed", {
          ...windowDescription,
          documentId: window.documentId,
          fileName: window.fileName,
          diagnostics: error.diagnostics,
          model: response.model,
          provider: response.provider,
          rawModelResponse: truncatedModelResponse(response.content),
          retrying: Boolean(profile.jsonRepairInstructions),
        });

        if (!profile.jsonRepairInstructions) {
          throw error;
        }

        failureKindHint = "provider";
        const invalidContent = response.content;
        const repairResponse = await withAIWindowMonitoring({
          heartbeatMs: aiHeartbeatMs,
          onHeartbeat: (elapsedMs) =>
            context.onWindowProgress?.({
              documentId: window.documentId,
              elapsedMs,
              failedWindowCount: errors.length,
              fileName: window.fileName,
              markdownCharacterCount: window.markdown.length,
              pageEnd: window.pageEnd,
              pageStart: window.pageStart,
              promptCharacterCount,
              providerId,
              providerModel,
              providerType,
              queuedElapsedMs,
              status: "waiting",
              timeoutMs: aiCallTimeoutMs,
              windowCount: windows.length,
              windowIndex: window.windowIndex + 1,
            }),
          profileLabel: `${profile.id} JSON repair`,
          providerId,
          providerModel,
          providerType,
          queuedElapsedMs,
          run: () =>
            context.aiService.generateText({
              maxOutputTokens: profile.maxOutputTokens ?? 6000,
              messages: [
                {
                  content: "You repair extraction JSON. Return only valid JSON.",
                  role: "system",
                },
                {
                  content: repairPrompt({
                    invalidContent,
                    parseError: error,
                    profile: profile as ExtractionProfile<unknown>,
                  }),
                  role: "user",
                },
              ],
              responseFormat: profile.responseFormat,
            }),
          timeoutMs: aiCallTimeoutMs,
          windowDescription: {
            ...windowDescription,
            retry: "json_repair",
          },
        });

        response = repairResponse;
        failureKindHint = "schema_validation";
        try {
          parsed = parseWindowOutput(profile, repairResponse.content, window);
        } catch (repairError) {
          console.error("[extraction:ai-window] model output JSON repair validation failed", {
            ...windowDescription,
            documentId: window.documentId,
            errorMessage: conciseError(repairError),
            fileName: window.fileName,
            model: repairResponse.model,
            provider: repairResponse.provider,
            rawModelResponse: truncatedModelResponse(repairResponse.content),
          });
          throw repairError;
        }
        console.info("[extraction:ai-window] model output JSON repair succeeded", {
          ...windowDescription,
          diagnostics: error.diagnostics,
        });
      }

      warnings.push(...parsed.warnings);
      items.push(...parsed.items);
      itemCountsByType = mergeItemCounts(itemCountsByType, parsed.itemCountsByType);
      provider = response.provider;
      model = response.model;
      console.info("[extraction:ai-window] extraction window completed", {
        ...windowDescription,
        itemCount: parsed.items.length,
        model: response.model,
        provider: response.provider,
      });
      await context.onWindowProgress?.({
        documentId: window.documentId,
        extractedItemCount: parsed.items.length,
        failedWindowCount: errors.length,
        fileName: window.fileName,
        pageEnd: window.pageEnd,
        pageStart: window.pageStart,
        status: "completed",
        windowCount: windows.length,
        windowIndex: window.windowIndex + 1,
      });
    } catch (error) {
      const parseError = error instanceof JsonModelOutputParseError ? error : null;
      const errorKind = parseError
        ? "json_parse"
        : failureKindHint === "provider"
          ? "provider"
          : "schema_validation";
      const providerError = errorKind === "provider"
        ? classifyAIProviderError(error)
        : null;
      const errorCode = parseError
        ? "EXTRACTION_JSON_PARSE_FAILED"
        : errorKind === "schema_validation"
          ? "EXTRACTION_SCHEMA_VALIDATION_FAILED"
          : providerError?.code ?? "AI_PROVIDER_REQUEST_FAILED";
      const errorMessage = providerError
        ? conciseError(providerError)
        : conciseError(error);
      const errorUserMessage = providerError?.userMessage ??
        (errorKind === "json_parse"
          ? "The AI provider returned JSON Matter Layer could not parse."
          : "The AI provider returned structured extraction data that did not match the expected schema.");

      errors.push(
        `Window ${window.windowIndex + 1} for ${window.fileName}: ${errorMessage}`,
      );
      errorCodes.push(errorCode);
      errorKinds.push(errorKind);
      if (providerError) {
        providerErrors.push(providerError);
      }
      console.error("[extraction:ai-window] extraction window failed", {
        ...windowDescription,
        diagnostics: parseError?.diagnostics,
        documentId: window.documentId,
        errorCode,
        errorKind,
        errorMessage,
        errorModel: response?.model ?? null,
        errorProvider: providerError?.provider ?? response?.provider ?? null,
        errorStatus: providerError?.status ?? null,
        errorUserMessage,
        fileName: window.fileName,
        rawModelResponse: truncatedModelResponse(response?.content),
      });
      await context.onWindowProgress?.({
        documentId: window.documentId,
        error: errorMessage,
        errorCode,
        errorKind,
        errorProvider: providerError?.provider ?? null,
        errorStatus: providerError?.status ?? null,
        errorUserMessage,
        failedWindowCount: errors.length,
        fileName: window.fileName,
        pageEnd: window.pageEnd,
        pageStart: window.pageStart,
        providerId,
        providerModel,
        providerType,
        queuedElapsedMs,
        status: "failed",
        timeoutMs: aiCallTimeoutMs,
        windowCount: windows.length,
        windowIndex: window.windowIndex + 1,
      });
    }
  }

  return {
    error: errors[0] ?? null,
    errorCode: errorCodes[0] ?? null,
    errorKind: errorKinds[0] ?? null,
    errorProvider: providerErrors[0]?.provider ?? null,
    errorStatus: providerErrors[0]?.status ?? null,
    errorUserMessage: providerErrors[0]?.userMessage ?? null,
    failedWindowCount: errors.length,
    itemCount: items.length,
    itemCountsByType,
    items,
    model,
    provider,
    status: statusForResult({
      failedWindowCount: errors.length,
      itemCount: items.length,
      totalWindowCount: windows.length,
    }),
    warnings,
    windowCount: windows.length,
  };
}
