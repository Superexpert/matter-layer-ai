import { checkDatabaseSetup } from "./checks/database-check";
import { checkGoogleOAuthSetup } from "./checks/google-oauth-check";
import type { SetupArea, SetupCheckResult, SetupStatus } from "./setup-types";

export const SETUP_AREA_ROUTES: Record<SetupArea, string> = {
  database: "/setup/database",
  "google-oauth": "/setup/google-oauth",
};

export const SETUP_CHECK_ORDER: SetupArea[] = [
  "google-oauth",
  "database",
];

export function orderChecks(checks: SetupCheckResult[]) {
  return SETUP_CHECK_ORDER.map((area) => {
    const check = checks.find((candidate) => candidate.area === area);

    if (!check) {
      throw new Error(`Missing setup check registration for ${area}.`);
    }

    return check;
  });
}

export function getSetupStatusFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SetupStatus {
  // Register future setup checks here, then add their area to SETUP_CHECK_ORDER.
  const checks = orderChecks([
    checkGoogleOAuthSetup(env),
    checkDatabaseSetup(env),
  ]);
  return createSetupStatusFromChecks(checks);
}

export function createSetupStatusFromChecks(
  checks: SetupCheckResult[],
): SetupStatus {
  const orderedChecks = orderChecks(checks);
  const firstBlockingCheck = orderedChecks.find(
    (check) => check.status !== "ready",
  );

  return {
    checks: orderedChecks,
    firstBlockingArea: firstBlockingCheck?.area,
    ready: !firstBlockingCheck,
  };
}

export function getSetupCheck(
  status: SetupStatus,
  area: SetupArea,
): SetupCheckResult {
  const check = status.checks.find((candidate) => candidate.area === area);

  if (!check) {
    throw new Error(`Setup status did not include ${area}.`);
  }

  return check;
}
