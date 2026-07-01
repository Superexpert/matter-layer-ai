import type { ChronologyExtractionProfileContext } from ".";
import {
  classifyAIProviderError,
  createAIProviderTimeoutError,
} from "@/services/ai/provider-errors";
import { buildChronologyUserPrompt, chronologySystemPrompt } from "./prompts";
import {
  countFactsByType,
  parseChronologyExtractionOutput,
  type ChronologyFact,
} from "./schema";
import { createChronologyMarkdownWindows } from "./windowing";

type GenerateTextResult = Awaited<
  ReturnType<ChronologyExtractionProfileContext["aiService"]["generateText"]>
>;

export type ChronologyExtractionResult = {
  error: string | null;
  errorCode: string | null;
  errorProvider: string | null;
  errorStatus: number | null;
  errorUserMessage: string | null;
  extractedFactCount: number;
  extractionWindowCount: number;
  facts: ChronologyFact[];
  factsByType: Record<string, number>;
  failedWindowCount: number;
  provider: string | null;
  model: string | null;
  status: "COMPLETED" | "FAILED" | "PARTIAL_FAILED";
};

function conciseError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 1000);
  }

  return "Chronology extraction failed.";
}

function defaultAIWindowTimeoutMs() {
  const rawValue = process.env.MATTER_LAYER_CHRONOLOGY_AI_WINDOW_TIMEOUT_MS;

  if (!rawValue) {
    return 90_000;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `MATTER_LAYER_CHRONOLOGY_AI_WINDOW_TIMEOUT_MS must be a positive integer: ${rawValue}`,
    );
  }

  return parsedValue;
}

function defaultAIHeartbeatMs() {
  const rawValue = process.env.MATTER_LAYER_CHRONOLOGY_AI_WINDOW_HEARTBEAT_MS;

  if (!rawValue) {
    return 10_000;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `MATTER_LAYER_CHRONOLOGY_AI_WINDOW_HEARTBEAT_MS must be a positive integer: ${rawValue}`,
    );
  }

  return parsedValue;
}

async function withAIWindowMonitoring(input: {
  onHeartbeat: (elapsedMs: number) => Promise<void> | void;
  promise: Promise<GenerateTextResult>;
  timeoutMs: number;
  heartbeatMs: number;
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
                `AI provider did not return chronology extraction within ${Math.round(input.timeoutMs / 1000)} seconds.`,
            }),
          );
        }, input.timeoutMs);
        heartbeatId = setInterval(() => {
          const elapsedMs = Date.now() - startedAt;

          console.info("[chronology:ai-window] still waiting for AI provider", {
            ...input.windowDescription,
            elapsedMs,
            heartbeatMs: input.heartbeatMs,
            timeoutMs: input.timeoutMs,
          });
          void Promise.resolve(input.onHeartbeat(elapsedMs)).catch((error: unknown) => {
            console.error("Chronology extraction heartbeat failed", {
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
  extractedFactCount: number;
  failedWindowCount: number;
  totalWindowCount: number;
}) {
  if (input.totalWindowCount === 0) {
    return "FAILED" as const;
  }

  if (input.failedWindowCount === 0) {
    return "COMPLETED" as const;
  }

  if (input.extractedFactCount > 0 || input.failedWindowCount < input.totalWindowCount) {
    return "PARTIAL_FAILED" as const;
  }

  return "FAILED" as const;
}

export async function runChronologyExtraction(
  context: ChronologyExtractionProfileContext,
): Promise<ChronologyExtractionResult> {
  const windows = context.readyDocuments.flatMap((document) =>
    createChronologyMarkdownWindows({
      documentId: document.id,
      fileName: document.fileName,
      markdown: document.markdown,
    }),
  );
  const facts: ChronologyFact[] = [];
  const errors: string[] = [];
  const providerErrors: ReturnType<typeof classifyAIProviderError>[] = [];
  let provider: string | null = null;
  let model: string | null = null;
  const aiCallTimeoutMs = context.aiCallTimeoutMs ?? defaultAIWindowTimeoutMs();
  const aiHeartbeatMs = context.aiHeartbeatMs ?? defaultAIHeartbeatMs();

  for (const window of windows) {
    const userPrompt = buildChronologyUserPrompt(window);
    const promptCharacterCount = chronologySystemPrompt.length + userPrompt.length;
    const windowDescription = {
      documentId: window.documentId,
      fileName: window.fileName,
      markdownCharacterCount: window.markdown.length,
      pageEnd: window.pageEnd,
      pageStart: window.pageStart,
      promptCharacterCount,
      timeoutMs: aiCallTimeoutMs,
      windowCount: windows.length,
      windowIndex: window.windowIndex + 1,
    };

    console.info("[chronology:ai-window] extraction window started", windowDescription);
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
      const response = await withAIWindowMonitoring({
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
        promise: context.aiService.generateText({
          maxOutputTokens: 6000,
          messages: [
            {
              content: chronologySystemPrompt,
              role: "system",
            },
            {
              content: userPrompt,
              role: "user",
            },
          ],
        }),
        timeoutMs: aiCallTimeoutMs,
        windowDescription,
      });
      const parsed = parseChronologyExtractionOutput(response.content);
      const windowFacts = parsed.facts.filter(
        (fact) =>
          fact.sourceDocumentId === window.documentId &&
          fact.sourceFileName === window.fileName,
      );

      provider = response.provider;
      model = response.model;
      facts.push(...windowFacts);
      console.info("[chronology:ai-window] extraction window completed", {
        ...windowDescription,
        extractedFactCount: windowFacts.length,
        model: response.model,
        provider: response.provider,
      });
      await context.onWindowProgress?.({
        documentId: window.documentId,
        extractedFactCount: windowFacts.length,
        failedWindowCount: errors.length,
        fileName: window.fileName,
        pageEnd: window.pageEnd,
        pageStart: window.pageStart,
        status: "completed",
        windowCount: windows.length,
        windowIndex: window.windowIndex + 1,
      });
    } catch (error) {
      const providerError = classifyAIProviderError(error);
      const errorMessage = conciseError(providerError);

      errors.push(
        `Window ${window.windowIndex + 1} for ${window.fileName}: ${errorMessage}`,
      );
      providerErrors.push(providerError);
      console.error("[chronology:ai-window] extraction window failed", {
        ...windowDescription,
        errorCode: providerError.code,
        errorMessage,
        errorProvider: providerError.provider,
        errorStatus: providerError.status,
        errorUserMessage: providerError.userMessage,
      });
      await context.onWindowProgress?.({
        documentId: window.documentId,
        error: errorMessage,
        errorCode: providerError.code,
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

  const status = statusForResult({
    extractedFactCount: facts.length,
    failedWindowCount: errors.length,
    totalWindowCount: windows.length,
  });
  const factsByType = countFactsByType(facts);

  return {
    error: errors[0] ?? null,
    errorCode: providerErrors[0]?.code ?? null,
    errorProvider: providerErrors[0]?.provider ?? null,
    errorStatus: providerErrors[0]?.status ?? null,
    errorUserMessage: providerErrors[0]?.userMessage ?? null,
    extractedFactCount: facts.length,
    extractionWindowCount: windows.length,
    facts,
    factsByType,
    failedWindowCount: errors.length,
    model,
    provider,
    status,
  };
}
