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

function conciseError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 1000);
  }

  return "Extraction failed.";
}

function defaultAIWindowTimeoutMs() {
  const rawValue = process.env.MATTER_LAYER_EXTRACTION_AI_WINDOW_TIMEOUT_MS;

  if (!rawValue) {
    return 90_000;
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
  promise: Promise<GenerateTextResult>;
  timeoutMs: number;
  windowDescription: Record<string, unknown>;
}) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  const startedAt = Date.now();

  try {
    return await Promise.race([
      input.promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            createAIProviderTimeoutError({
              message:
                `AI provider did not return ${input.profileLabel} extraction within ${Math.round(input.timeoutMs / 1000)} seconds.`,
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
            timeoutMs: input.timeoutMs,
          });
          void Promise.resolve(input.onHeartbeat(elapsedMs)).catch((error: unknown) => {
            console.error("Extraction heartbeat failed", {
              error,
            });
          });
        }, input.heartbeatMs);
      }),
    ]);
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
  let itemCountsByType: Record<string, number> = {};
  let provider: string | null = null;
  let model: string | null = null;
  const aiCallTimeoutMs = context.aiCallTimeoutMs ?? defaultAIWindowTimeoutMs();
  const aiHeartbeatMs = context.aiHeartbeatMs ?? defaultAIHeartbeatMs();

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
      timeoutMs: aiCallTimeoutMs,
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
      status: "started",
      timeoutMs: aiCallTimeoutMs,
      windowCount: windows.length,
      windowIndex: window.windowIndex + 1,
    });

    try {
      let response = await withAIWindowMonitoring({
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
            status: "waiting",
            timeoutMs: aiCallTimeoutMs,
            windowCount: windows.length,
            windowIndex: window.windowIndex + 1,
          }),
        profileLabel: profile.id,
        promise: context.aiService.generateText({
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
        parsed = parseWindowOutput(profile, response.content, window);
      } catch (error) {
        if (!(error instanceof JsonModelOutputParseError)) {
          console.error("[extraction:ai-window] model output schema validation failed", {
            ...windowDescription,
            errorMessage: conciseError(error),
          });
          throw error;
        }

        console.error("[extraction:ai-window] model output JSON parse failed", {
          ...windowDescription,
          diagnostics: error.diagnostics,
          retrying: Boolean(profile.jsonRepairInstructions),
        });

        if (!profile.jsonRepairInstructions) {
          throw error;
        }

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
              status: "waiting",
              timeoutMs: aiCallTimeoutMs,
              windowCount: windows.length,
              windowIndex: window.windowIndex + 1,
            }),
          profileLabel: `${profile.id} JSON repair`,
          promise: context.aiService.generateText({
            maxOutputTokens: profile.maxOutputTokens ?? 6000,
            messages: [
              {
                content: "You repair extraction JSON. Return only valid JSON.",
                role: "system",
              },
              {
                content: repairPrompt({
                  invalidContent: response.content,
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
        parsed = parseWindowOutput(profile, repairResponse.content, window);
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
      const providerError = classifyAIProviderError(error);
      const errorMessage = conciseError(providerError);

      errors.push(
        `Window ${window.windowIndex + 1} for ${window.fileName}: ${errorMessage}`,
      );
      errorCodes.push(parseError ? "EXTRACTION_JSON_PARSE_FAILED" : providerError.code);
      providerErrors.push(providerError);
      console.error("[extraction:ai-window] extraction window failed", {
        ...windowDescription,
        diagnostics: parseError?.diagnostics,
        errorCode: providerError.code,
        errorMessage,
        errorProvider: providerError.provider,
        errorStatus: providerError.status,
        errorUserMessage: providerError.userMessage,
      });
      await context.onWindowProgress?.({
        documentId: window.documentId,
        error: errorMessage,
        errorCode: parseError ? "EXTRACTION_JSON_PARSE_FAILED" : providerError.code,
        errorProvider: providerError.provider,
        errorStatus: providerError.status,
        errorUserMessage: providerError.userMessage,
        failedWindowCount: errors.length,
        fileName: window.fileName,
        pageEnd: window.pageEnd,
        pageStart: window.pageStart,
        status: "failed",
        windowCount: windows.length,
        windowIndex: window.windowIndex + 1,
      });
    }
  }

  return {
    error: errors[0] ?? null,
    errorCode: errorCodes[0] ?? null,
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
