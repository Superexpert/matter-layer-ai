import { expect, test } from "@playwright/test";

import { addTestAuthSession, startNextTestServer } from "./next-test-server";

test.describe.configure({ mode: "serial" });

test("rejects empty AI chat messages without calling the provider", async ({
  page,
}) => {
  const server = await startNextTestServer({
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    port: 3240,
  });

  try {
    await addTestAuthSession(page, server.baseURL);

    const response = await page.request.post(`${server.baseURL}/api/ai/chat`, {
      data: {
        matterId: "test-matter",
        messages: [],
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must include matterId and messages.",
    });
  } finally {
    await server.stop();
  }
});
