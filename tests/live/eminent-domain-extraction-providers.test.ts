import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { AnthropicProvider } from "@/services/ai/providers/anthropic-provider-core";
import { OllamaProvider } from "@/services/ai/providers/ollama-provider-core";
import { OpenAIProvider } from "@/services/ai/providers/openai-provider-core";
import { extractPdfPages } from "@/services/matter-documents/pdfjs";
import { runExtractionProfile } from "@/workflow-steps/extraction/profile-runner";
import { eminentDomainFactsProfile } from "@/workflow-steps/extraction/profiles/eminent-domain";
import type { ExtractionAIService } from "@/workflow-steps/extraction/types";

type LiveProviderCase = {
  createProvider: () => ExtractionAIService;
  enabled: boolean;
  missingReason: string;
  model: string;
  name: string;
  provider: "anthropic" | "ollama" | "openai";
};

type ReadyDocument = {
  fileName: string;
  id: string;
  markdown: string;
};

const EMINENT_DOMAIN_SAMPLE_DIR = path.join(
  process.cwd(),
  "sample-evidence",
  "eminent-domain",
);

function envValue(name: string) {
  const value = process.env[name]?.trim();

  return value || null;
}

function envProviderModel(provider: LiveProviderCase["provider"]) {
  if (process.env.AI_PROVIDER === provider) {
    return envValue("AI_MODEL");
  }

  return null;
}

function positiveIntegerEnv(name: string) {
  const value = envValue(name);

  if (!value) {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer when set.`);
  }

  return parsedValue;
}

function requestedLiveProviders() {
  const value = envValue("MATTER_LAYER_LIVE_EXTRACTION_PROVIDERS");

  if (!value) {
    return new Set<LiveProviderCase["provider"]>([
      "anthropic",
      "ollama",
      "openai",
    ]);
  }

  const providers = value.split(",").map((provider) => provider.trim());
  const supportedProviders = new Set<LiveProviderCase["provider"]>([
    "anthropic",
    "ollama",
    "openai",
  ]);

  for (const provider of providers) {
    if (!supportedProviders.has(provider as LiveProviderCase["provider"])) {
      throw new Error(
        `Unsupported MATTER_LAYER_LIVE_EXTRACTION_PROVIDERS entry: ${provider}`,
      );
    }
  }

  return new Set(providers as LiveProviderCase["provider"][]);
}

async function markdownForSampleFile(fileName: string) {
  const filePath = path.join(EMINENT_DOMAIN_SAMPLE_DIR, fileName);
  const bytes = await readFile(filePath);

  if (fileName.endsWith(".txt")) {
    return bytes.toString("utf8");
  }

  if (!fileName.endsWith(".pdf")) {
    throw new Error(`Unsupported eminent-domain sample file type: ${fileName}`);
  }

  const extractedPdf = await extractPdfPages(bytes);

  return extractedPdf.pageTexts
    .map((text, index) => [
      `<!-- ml:page {"page":${index + 1}} -->`,
      text,
    ].join("\n\n"))
    .join("\n\n");
}

async function loadEminentDomainSampleDocuments(): Promise<ReadyDocument[]> {
  const fileNames = (await readdir(EMINENT_DOMAIN_SAMPLE_DIR))
    .filter((fileName) => fileName.endsWith(".pdf") || fileName.endsWith(".txt"))
    .sort();
  const documentLimit = positiveIntegerEnv(
    "MATTER_LAYER_LIVE_EXTRACTION_DOCUMENT_LIMIT",
  );
  const selectedFileNames = documentLimit
    ? fileNames.slice(0, documentLimit)
    : fileNames;

  return Promise.all(
    selectedFileNames.map(async (fileName, index) => ({
      fileName,
      id: `eminent_domain_sample_${index + 1}`,
      markdown: await markdownForSampleFile(fileName),
    })),
  );
}

function liveProviderCases(): LiveProviderCase[] {
  const requestedProviders = requestedLiveProviders();
  const openAIModel =
    envValue("MATTER_LAYER_LIVE_OPENAI_MODEL") ??
    envValue("OPENAI_MODEL") ??
    envProviderModel("openai") ??
    "gpt-5-mini";
  const anthropicModel =
    envValue("MATTER_LAYER_LIVE_ANTHROPIC_MODEL") ??
    envValue("ANTHROPIC_MODEL") ??
    envProviderModel("anthropic") ??
    "sonnet-4";
  const ollamaBaseUrl =
    envValue("MATTER_LAYER_LIVE_OLLAMA_BASE_URL") ??
    envValue("OLLAMA_BASE_URL") ??
    envValue("AI_BASE_URL") ??
    "http://localhost:11434";
  const ollamaModel =
    envValue("MATTER_LAYER_LIVE_OLLAMA_MODEL") ??
    envValue("OLLAMA_MODEL") ??
    envProviderModel("ollama") ??
    "gemma3:4b";
  const openAIKey = envValue("OPENAI_API_KEY");
  const anthropicKey = envValue("ANTHROPIC_API_KEY");

  const providerCases = [
    {
      createProvider: () =>
        new OpenAIProvider({
          apiKey: openAIKey ?? "",
          model: openAIModel,
        }),
      enabled: Boolean(openAIKey),
      missingReason: "OPENAI_API_KEY is not set.",
      model: openAIModel,
      name: `OpenAI ${openAIModel}`,
      provider: "openai",
    },
    {
      createProvider: () =>
        new AnthropicProvider({
          apiKey: anthropicKey ?? "",
          model: anthropicModel,
        }),
      enabled: Boolean(anthropicKey),
      missingReason: "ANTHROPIC_API_KEY is not set.",
      model: anthropicModel,
      name: `Claude ${anthropicModel}`,
      provider: "anthropic",
    },
    {
      createProvider: () =>
        new OllamaProvider({
          baseUrl: ollamaBaseUrl,
          model: ollamaModel,
        }),
      enabled: requestedProviders.has("ollama"),
      missingReason:
        "Ollama was not selected in MATTER_LAYER_LIVE_EXTRACTION_PROVIDERS.",
      model: ollamaModel,
      name: `Ollama ${ollamaModel}`,
      provider: "ollama",
    },
  ] satisfies LiveProviderCase[];

  return providerCases.map((providerCase) => ({
    ...providerCase,
    enabled: providerCase.enabled && requestedProviders.has(providerCase.provider),
    missingReason: requestedProviders.has(providerCase.provider)
      ? providerCase.missingReason
      : `${providerCase.provider} was not selected in MATTER_LAYER_LIVE_EXTRACTION_PROVIDERS.`,
  }));
}

describe("live Eminent Domain extraction across AI providers", () => {
  test.each(liveProviderCases())(
    "$name extracts structured assessment data from sample evidence",
    async (providerCase) => {
      if (!providerCase.enabled) {
        console.warn(`Skipping ${providerCase.name}: ${providerCase.missingReason}`);
        return;
      }

      const readyDocuments = await loadEminentDomainSampleDocuments();

      expect(readyDocuments.length).toBeGreaterThan(0);
      expect(
        readyDocuments.every((document) => document.markdown.trim().length > 0),
      ).toBe(true);

      const result = await runExtractionProfile(eminentDomainFactsProfile, {
        aiCallTimeoutMs:
          positiveIntegerEnv("MATTER_LAYER_LIVE_EXTRACTION_AI_TIMEOUT_MS") ??
          180_000,
        aiService: providerCase.createProvider(),
        readyDocuments,
      });

      console.info("[live-extraction]", {
        failedWindowCount: result.failedWindowCount,
        itemCount: result.itemCount,
        model: result.model,
        provider: result.provider,
        status: result.status,
        warnings: result.warnings.map((warning) => warning.code),
        windowCount: result.windowCount,
      });

      expect(result.provider).toBe(providerCase.provider);
      expect(result.model).toBeTruthy();
      expect(result.status).toBe("COMPLETED");
      expect(result.failedWindowCount).toBe(0);
      expect(result.windowCount).toBeGreaterThanOrEqual(readyDocuments.length);
      expect(result.itemCount).toBeGreaterThan(0);
      expect(Object.keys(result.itemCountsByType).length).toBeGreaterThan(0);
      expect(
        result.items.every(
          (item) =>
            typeof item.evidence.documentId === "string" &&
            typeof item.evidence.documentName === "string" &&
            typeof item.factType === "string" &&
            item.fields &&
            typeof item.fields === "object",
        ),
      ).toBe(true);
      expect(result.items.map((item) => item.factType)).not.toContain(
        "eminent_domain_case_assessment",
      );
    },
  );
});
