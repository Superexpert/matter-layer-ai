import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { PrismaClient, UserRole } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { OllamaProvider } from "../../services/ai/providers/ollama-provider-core";
import { createAIProviderFromSettings } from "../../services/ai/providers/provider-factory-core";
import type { AIStreamEvent } from "../../services/ai/types";
import {
  addTestAuthSession,
  startNextTestServer,
} from "./next-test-server";

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@smithlaw.com`;
}

async function seedAdmin(email: string) {
  return prisma.user.upsert({
    create: {
      email,
      name: email,
      role: UserRole.ADMIN,
    },
    update: {
      role: UserRole.ADMIN,
    },
    where: {
      email,
    },
  });
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startMockOllamaServer(models: string[]) {
  const chatRequests: unknown[] = [];
  const server = createServer(async (request, response: ServerResponse) => {
    if (request.method === "GET" && request.url === "/api/tags") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          models: models.map((name) => ({ name })),
        }),
      );
      return;
    }

    if (request.method === "POST" && request.url === "/api/chat") {
      const body = JSON.parse(await readRequestBody(request)) as unknown;
      chatRequests.push(body);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          message: {
            content: "ready",
            role: "assistant",
          },
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Mock Ollama server did not bind to a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    chatRequests,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

test("Admin can configure Ollama Local without an API key", async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL and provider table.");

  const adminEmail = uniqueEmail("ollama-admin");
  const mockOllama = await startMockOllamaServer([
    "llama3.2:latest",
    "gemma3:4b",
    "gemma2:9b",
  ]);

  await seedAdmin(adminEmail);
  await prisma.aiProviderConfig.deleteMany();
  await prisma.appSettings.deleteMany({
    where: {
      id: "app",
    },
  });

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3268,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Ollama Admin",
    });
    await page.goto(`${server.baseURL}/app/admin`);

    await expect(page.getByTestId("ai-provider-select")).toContainText(
      "Ollama Local",
    );
    await page.getByTestId("ai-provider-select").selectOption("ollama");

    await expect(page.getByTestId("ai-api-key-input")).toHaveCount(0);
    await expect(page.getByTestId("ollama-base-url-input")).toHaveValue(
      "http://localhost:11434",
    );
    await expect(page.getByTestId("save-ai-settings-button")).toBeDisabled();

    await page.getByTestId("ollama-base-url-input").fill(mockOllama.baseUrl);
    await expect(page.getByTestId("save-ai-settings-button")).toBeDisabled();

    await page.getByTestId("refresh-ollama-models-button").click();
    await expect(page.getByTestId("ollama-model-select")).toContainText(
      "gemma3:4b",
    );
    await expect(page.getByTestId("ollama-model-select")).toHaveValue(
      "gemma3:4b",
    );
    await expect(page.getByTestId("save-ai-settings-button")).toBeEnabled();

    await page.getByTestId("save-ai-settings-button").click();
    await expect(page).toHaveURL(`${server.baseURL}/app/admin?saved=ai`);

    const config = await prisma.aiProviderConfig.findFirstOrThrow({
      where: {
        provider: "ollama",
      },
    });

    expect(config).toMatchObject({
      apiKey: null,
      baseUrl: mockOllama.baseUrl,
      isActive: true,
      model: "gemma3:4b",
      provider: "ollama",
    });

    const ollamaCard = page
      .getByTestId("ai-provider-card")
      .filter({ hasText: "Ollama Local" });

    await expect(ollamaCard.getByTestId("provider-model")).toContainText(
      "gemma3:4b",
    );
    await expect(ollamaCard.getByTestId("provider-base-url")).toContainText(
      mockOllama.baseUrl,
    );
    await expect(ollamaCard.getByTestId("provider-api-key-masked")).toHaveCount(
      0,
    );
  } finally {
    await server.stop();
    await mockOllama.stop();
  }
});

test("Admin Ollama setup disables save when Ollama is unavailable or no model is selected", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL and provider table.");

  const adminEmail = uniqueEmail("ollama-unavailable-admin");
  const mockOllama = await startMockOllamaServer([]);

  await seedAdmin(adminEmail);
  await prisma.aiProviderConfig.deleteMany();

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3269,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Ollama Unavailable Admin",
    });
    await page.goto(`${server.baseURL}/app/admin`);
    await page.getByTestId("ai-provider-select").selectOption("ollama");

    await page
      .getByTestId("ollama-base-url-input")
      .fill("http://127.0.0.1:9");
    await page.getByTestId("refresh-ollama-models-button").click();
    await expect(page.getByTestId("ollama-status-message")).toContainText(
      "Matter Layer could not reach Ollama",
    );
    await expect(page.getByTestId("save-ai-settings-button")).toBeDisabled();

    await page.getByTestId("ollama-base-url-input").fill(mockOllama.baseUrl);
    await page.getByTestId("refresh-ollama-models-button").click();
    await expect(page.getByTestId("ollama-status-message")).toContainText(
      "Ollama is running, but no models are installed yet.",
    );
    await expect(page.getByTestId("save-ai-settings-button")).toBeDisabled();
  } finally {
    await server.stop();
    await mockOllama.stop();
  }
});

test("Admin Ollama setup warns when no Gemma model is installed", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL and provider table.");

  const adminEmail = uniqueEmail("ollama-non-gemma-admin");
  const mockOllama = await startMockOllamaServer(["llama3.2:latest"]);

  await seedAdmin(adminEmail);
  await prisma.aiProviderConfig.deleteMany();

  const server = await startNextTestServer({
    databaseUrl: process.env.DATABASE_URL,
    port: 3270,
  });

  try {
    await addTestAuthSession(page, server.baseURL, {
      email: adminEmail,
      name: "Ollama Non Gemma Admin",
    });
    await page.goto(`${server.baseURL}/app/admin`);
    await page.getByTestId("ai-provider-select").selectOption("ollama");
    await page.getByTestId("ollama-base-url-input").fill(mockOllama.baseUrl);
    await page.getByTestId("refresh-ollama-models-button").click();

    await expect(page.getByTestId("ollama-model-select")).toHaveValue(
      "llama3.2:latest",
    );
    await expect(page.getByTestId("ollama-gemma-warning")).toContainText(
      "No Gemma model was found.",
    );
    await expect(page.getByTestId("save-ai-settings-button")).toBeEnabled();
  } finally {
    await server.stop();
    await mockOllama.stop();
  }
});

test("OllamaProvider maps messages and returns non-streaming assistant content", async () => {
  const capturedRequests: unknown[] = [];
  const provider = new OllamaProvider({
    baseUrl: "http://matterlayer-ai.internal:11434",
    fetch: async (_url, init) => {
      capturedRequests.push(JSON.parse(String(init?.body)));

      return new Response(
        JSON.stringify({
          message: {
            content: "Generated Ollama response",
          },
        }),
      );
    },
    model: "gemma3:4b",
  });

  await expect(
    provider.generateText({
      maxOutputTokens: 256,
      messages: [
        {
          content: "You are Matter Layer.",
          role: "system",
        },
        {
          content: "Draft a summary.",
          role: "user",
        },
        {
          content: "Use a neutral tone.",
          role: "assistant",
        },
      ],
      temperature: 0.2,
    }),
  ).resolves.toEqual({
    content: "Generated Ollama response",
    model: "gemma3:4b",
    provider: "ollama",
  });

  expect(capturedRequests[0]).toEqual({
    messages: [
      {
        content: "You are Matter Layer.",
        role: "system",
      },
      {
        content: "Draft a summary.",
        role: "user",
      },
      {
        content: "Use a neutral tone.",
        role: "assistant",
      },
    ],
    model: "gemma3:4b",
    options: {
      num_predict: 256,
      temperature: 0.2,
    },
    stream: false,
  });
});

test("OllamaProvider streams newline-delimited JSON chunks", async () => {
  const encoder = new TextEncoder();
  const provider = new OllamaProvider({
    baseUrl: "http://localhost:11434",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                '{"message":{"content":"Hello"},"done":false}\n{"message":{"content":" from Ollama"},"done":false}\n',
              ),
            );
            controller.enqueue(encoder.encode('{"done":true}\n'));
            controller.close();
          },
        }),
      ),
    model: "gemma3:4b",
  });
  const events: AIStreamEvent[] = [];

  for await (const event of provider.streamText({
    messages: [
      {
        content: "Draft a summary.",
        role: "user",
      },
    ],
  })) {
    events.push(event);
  }

  expect(events).toEqual([
    {
      delta: "Hello",
      type: "text-delta",
    },
    {
      delta: " from Ollama",
      type: "text-delta",
    },
    {
      response: {
        content: "Hello from Ollama",
        model: "gemma3:4b",
        provider: "ollama",
      },
      type: "done",
    },
  ]);
});

test("provider selection returns Ollama from database-style settings", () => {
  const provider = createAIProviderFromSettings({
    apiKey: null,
    baseUrl: "http://localhost:11434",
    model: "gemma3:4b",
    provider: "ollama",
  });

  expect(provider.name).toBe("ollama");
});

