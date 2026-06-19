import { expect, test } from "@playwright/test";

import {
  REQUIRED_AUTH_ENV_VARS,
} from "../../lib/auth/env";
import { startNextTestServer } from "./next-test-server";

test.describe.configure({ mode: "serial" });

const missingEnvScenarios = REQUIRED_AUTH_ENV_VARS.map((missingEnvVar, index) => ({
  missingEnvVar,
  port: 3200 + index,
}));

for (const { missingEnvVar, port } of missingEnvScenarios) {
  test(`shows auth setup instructions when ${missingEnvVar} is missing`, async ({
    page,
  }) => {
    const server = await startNextTestServer({ missingEnvVar, port });

    try {
      await page.goto(server.baseURL);

      const setupInstructions = page.getByTestId("auth-setup-instructions");

      await expect(setupInstructions).toBeVisible();
      await expect(
        setupInstructions.getByTestId("missing-auth-env-var").filter({
          hasText: missingEnvVar,
        }),
      ).toBeVisible();
    } finally {
      await server.stop();
    }
  });
}

test("does not show auth setup instructions when all auth env vars are present", async ({
  page,
}) => {
  const server = await startNextTestServer({
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    port: 3204,
  });

  try {
    await page.goto(server.baseURL);

    await expect(page.getByTestId("auth-setup-instructions")).toHaveCount(0);
    await expect(page).toHaveURL(`${server.baseURL}/login`);
    await expect(
      page.getByRole("heading", { name: "Sign in required" }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});
