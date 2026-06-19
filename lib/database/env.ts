export const REQUIRED_DATABASE_ENV_VARS = ["DATABASE_URL"] as const;

export type RequiredDatabaseEnvVar =
  (typeof REQUIRED_DATABASE_ENV_VARS)[number];

export function getMissingDatabaseEnvVars(
  env: NodeJS.ProcessEnv = process.env,
) {
  return REQUIRED_DATABASE_ENV_VARS.filter((name) => !env[name]?.trim());
}

export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env) {
  return getMissingDatabaseEnvVars(env).length === 0;
}
