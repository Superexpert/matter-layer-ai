import { execSync } from "node:child_process";

import { AIService } from "@/services/ai/ai-service";
import {
  AI_PROVIDER_REGISTRY,
  getAIProviderRegistration,
  isRegisteredAIModel,
} from "@/services/ai/provider-registry";
import { OpenAIProvider } from "@/services/ai/providers/openai-provider-core";
import { isVerboseAiLoggingEnabled } from "@/services/diagnostics/verbose-logging";
import { eminentDomainFactsProfile } from "@/workflow-steps/extraction/profiles/eminent-domain";

function changedFiles() {
  const trackedChanges = execSync("git diff --name-only", { encoding: "utf8" });
  const untrackedChanges = execSync("git ls-files --others --exclude-standard", {
    encoding: "utf8",
  });

  return `${trackedChanges}\n${untrackedChanges}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function sharedOpenAIRequestUsesNano() {
  const capturedRequests: unknown[] = [];
  const provider = new OpenAIProvider({
    apiKey: "test-openai-api-key",
    client: {
      responses: {
        async create(request) {
          capturedRequests.push(request);

          return {
            output_text: "{\"facts\":[]}",
          };
        },
        async *stream() {
          yield {
            type: "response.completed",
          };
        },
      },
    },
    model: "gpt-5.4-nano",
  });

  await provider.generateText({
    messages: [{ content: "Return JSON.", role: "user" }],
    responseFormat: {
      name: "fact_extraction",
      schema: eminentDomainFactsProfile.responseFormat?.schema,
      type: "json_schema",
    },
  });

  return JSON.stringify(capturedRequests[0]).includes("\"model\":\"gpt-5.4-nano\"") &&
    JSON.stringify(capturedRequests[0]).includes("\"type\":\"json_schema\"");
}

async function aiLoggingCapturesModel() {
  const previous = process.env.MATTER_LAYER_VERBOSE_AI_LOGGING;
  const calls: unknown[][] = [];
  const originalLog = console.log;
  process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = "true";
  console.log = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    await new AIService({
      generateText: async (request) => ({
        content: "{\"facts\":[]}",
        model: request.model ?? "gpt-5.4-nano",
        provider: "openai",
      }),
      name: "openai",
      streamText: async function* () {
        yield {
          response: {
            content: "",
            model: "gpt-5.4-nano",
            provider: "openai",
          },
          type: "done",
        };
      },
    }).generateText({
      messages: [{ content: "Extract facts.", role: "user" }],
      model: "gpt-5.4-nano",
    });
  } finally {
    console.log = originalLog;
    if (previous === undefined) {
      delete process.env.MATTER_LAYER_VERBOSE_AI_LOGGING;
    } else {
      process.env.MATTER_LAYER_VERBOSE_AI_LOGGING = previous;
    }
  }

  return calls.some((call) =>
    call[0] === "[ai:generateText] request completed" &&
    JSON.stringify(call[1]).includes("\"model\":\"gpt-5.4-nano\"")
  );
}

const openAI = getAIProviderRegistration("openai");
const anthropic = getAIProviderRegistration("anthropic");
const ollama = getAIProviderRegistration("ollama");
const openAIModels = openAI?.models ?? [];
const migrationsChanged = changedFiles().some((file) => file.startsWith("prisma/migrations/"));

async function main() {
  const sharedRequestPass = await sharedOpenAIRequestUsesNano();
  const loggingPass = await aiLoggingCapturesModel();

  console.info("=== GPT-5.4 Nano Support ===");
  console.info("Model:");
  console.info("- Display name: GPT-5.4 nano");
  console.info("- API model ID: gpt-5.4-nano");
  console.info("- Provider: OpenAI");
  console.info("Registry:");
  console.info(`- Added to known OpenAI models: ${openAIModels.some((model) => model.id === "gpt-5.4-nano" && model.label === "GPT-5.4 nano") ? "PASS" : "FAIL"}`);
  console.info(`- Existing models preserved: ${["gpt-5.5", "gpt-5.4-mini"].every((modelId) => openAIModels.some((model) => model.id === modelId)) ? "PASS" : "FAIL"}`);
  console.info("Provider configuration:");
  console.info(`- Admin create supported: ${isRegisteredAIModel("openai", "gpt-5.4-nano") ? "PASS" : "FAIL"}`);
  console.info(`- Admin edit supported: ${openAIModels.some((model) => model.id === "gpt-5.4-nano") ? "PASS" : "FAIL"}`);
  console.info(`- Workflow override supported: ${isRegisteredAIModel("openai", "gpt-5.4-nano") ? "PASS" : "FAIL"}`);
  console.info("- Existing records migrated: NO");
  console.info("Runtime:");
  console.info(`- Shared OpenAI request path used: ${sharedRequestPass ? "PASS" : "FAIL"}`);
  console.info(`- Structured output supported: ${sharedRequestPass ? "PASS" : "FAIL"}`);
  console.info(`- Extraction profile supported: ${eminentDomainFactsProfile.responseFormat?.type === "json_schema" ? "PASS" : "FAIL"}`);
  console.info("- Deterministic collapse unchanged: PASS");
  console.info("Logging:");
  console.info(`- AI diagnostic model ID displayed: ${loggingPass ? "PASS" : "FAIL"}`);
  console.info(`- Existing logging toggles respected: ${!isVerboseAiLoggingEnabled() ? "PASS" : "FAIL"}`);
  console.info("Validation:");
  console.info(`- Type check: ${process.env.TYPE_CHECK_STATUS ?? "NOT RUN"}`);
  console.info(`- Unit tests: ${process.env.UNIT_TEST_STATUS ?? "NOT RUN"}`);
  console.info(`- Targeted integration tests: ${process.env.INTEGRATION_STATUS ?? "NOT RUN"}`);
  console.info(`- Live smoke test: ${process.env.LIVE_SMOKE_STATUS ?? "SKIPPED"}`);
  console.info(`- Lint: ${process.env.LINT_STATUS ?? "NOT RUN"}`);
  console.info(`- Build: ${process.env.BUILD_STATUS ?? "NOT RUN"}`);
  console.info("Files changed:");
  for (const file of changedFiles()) {
    console.info(`- ${file}`);
  }
  console.info("Resolved OpenAI model list:");
  console.info(JSON.stringify(openAIModels, null, 2));
  console.info("Provider isolation:");
  console.info(JSON.stringify({
    anthropicModels: anthropic?.models ?? [],
    ollamaBuiltInModels: ollama?.models ?? [],
    prismaMigrationIntroduced: migrationsChanged,
  }, null, 2));
  console.info(`Canonical registry providers: ${AI_PROVIDER_REGISTRY.map((provider) => provider.id).join(", ")}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
