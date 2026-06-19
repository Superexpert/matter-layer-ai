import { spawn, type ChildProcess } from "node:child_process";

import type { Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

import type { RequiredAuthEnvVar } from "../../lib/auth/env";

const dummyAuthEnv: Record<RequiredAuthEnvVar, string> = {
  AUTH_GOOGLE_ID: "test-google-id",
  AUTH_GOOGLE_SECRET: "test-google-secret",
  AUTH_SECRET: "test-auth-secret-at-least-32-characters",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
};

type NextTestServer = {
  baseURL: string;
  stop: () => Promise<void>;
};

type StartNextTestServerOptions = {
  aiOpenAIModel?: string;
  aiProvider?: string;
  openAIAPIKey?: string;
  databaseUrl?: string;
  missingEnvVar?: RequiredAuthEnvVar;
  port: number;
};

function authEnvForScenario({
  missingEnvVar,
  port,
}: StartNextTestServerOptions) {
  const env = {
    ...dummyAuthEnv,
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
  };

  if (missingEnvVar) {
    env[missingEnvVar] = "";
  }

  return env;
}

async function waitForServer(url: string, process: ChildProcess) {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  const output: string[] = [];

  process.stdout?.on("data", (data) => {
    output.push(String(data));
  });

  process.stderr?.on("data", (data) => {
    output.push(String(data));
  });

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        [
          `Next dev server exited with code ${process.exitCode}`,
          output.join("").trim(),
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    try {
      const response = await fetch(url);

      if (response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

export async function startNextTestServer(
  options: StartNextTestServerOptions,
): Promise<NextTestServer> {
  const baseURL = `http://127.0.0.1:${options.port}`;
  const child = spawn(
    "npm",
    [
      "run",
      "dev",
      "--",
      "--port",
      String(options.port),
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        ...authEnvForScenario(options),
        AI_OPENAI_MODEL: options.aiOpenAIModel ?? "gpt-5",
        AI_PROVIDER: options.aiProvider ?? "openai",
        DATABASE_URL: options.databaseUrl ?? process.env.DATABASE_URL ?? "",
        OPENAI_API_KEY: options.openAIAPIKey ?? "test-openai-api-key",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitForServer(`${baseURL}/favicon.ico`, child);

  return {
    baseURL,
    stop: async () => {
      if (child.pid && child.exitCode === null) {
        process.kill(-child.pid, "SIGTERM");
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  };
}

type TestAuthUser = {
  email?: string;
  name?: string;
  sub?: string;
};

export async function addTestAuthSession(
  page: Page,
  baseURL: string,
  user: TestAuthUser = {},
) {
  const url = new URL(baseURL);
  const email = user.email ?? "lawyer@smithlaw.com";
  const sessionToken = await encode({
    secret: dummyAuthEnv.AUTH_SECRET,
    token: {
      email,
      name: user.name ?? "Test Lawyer",
      picture: null,
      sub: user.sub ?? email,
    },
  });

  await page.context().addCookies([
    {
      domain: url.hostname,
      httpOnly: true,
      name: "next-auth.session-token",
      path: "/",
      sameSite: "Lax",
      value: sessionToken,
    },
  ]);
}
