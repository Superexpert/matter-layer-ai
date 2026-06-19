import "server-only";

import { redirect } from "next/navigation";

import { checkDatabaseHealth } from "./checks/database-health-check";
import {
  createSetupStatusFromChecks,
  getSetupCheck,
  getSetupStatusFromEnv,
  SETUP_AREA_ROUTES,
} from "./setup-status";

type GetSetupStatusOptions = {
  verifyDatabase?: boolean;
};

export async function getSetupStatus(options: GetSetupStatusOptions = {}) {
  const status = getSetupStatusFromEnv();

  if (!options.verifyDatabase) {
    return status;
  }

  const googleOAuthCheck = getSetupCheck(status, "google-oauth");
  const databaseCheck = getSetupCheck(status, "database");

  if (
    googleOAuthCheck.status !== "ready" ||
    databaseCheck.status !== "ready"
  ) {
    return status;
  }

  const databaseHealthCheck = await checkDatabaseHealth();

  return createSetupStatusFromChecks([
    googleOAuthCheck,
    databaseHealthCheck,
    getSetupCheck(status, "ai-provider"),
  ]);
}

export async function requireAppSetup() {
  const status = await getSetupStatus({ verifyDatabase: true });

  if (status.ready) {
    return;
  }

  redirect(SETUP_AREA_ROUTES[status.firstBlockingArea!]);
}
