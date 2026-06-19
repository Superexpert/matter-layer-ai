import "server-only";

import { redirect } from "next/navigation";

import {
  getSetupStatusFromEnv,
  SETUP_AREA_ROUTES,
} from "./setup-status";

export async function getSetupStatus() {
  return getSetupStatusFromEnv();
}

export async function requireAppSetup() {
  const status = await getSetupStatus();

  if (status.ready) {
    return;
  }

  redirect(SETUP_AREA_ROUTES[status.firstBlockingArea!]);
}
