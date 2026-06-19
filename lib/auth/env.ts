export const REQUIRED_AUTH_ENV_VARS = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
] as const;

export type RequiredAuthEnvVar = (typeof REQUIRED_AUTH_ENV_VARS)[number];

export function getMissingAuthEnvVars(
  env: Partial<Record<RequiredAuthEnvVar, string | undefined>> = process.env,
) {
  return REQUIRED_AUTH_ENV_VARS.filter((name) => !env[name]?.trim());
}
