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
