import type { Metadata } from "next";
import { connection } from "next/server";

import { GoogleOAuthSetup } from "../components/GoogleOAuthSetup";
import { getSetupCheck, getSetupStatus } from "@/services/setup";

export const metadata: Metadata = {
  title: "Google OAuth Setup | Matter Layer",
  description: "Configure Google OAuth sign-in for Matter Layer.",
};

export default async function GoogleOAuthPage() {
  await connection();

  const status = await getSetupStatus();
  const check = getSetupCheck(status, "google-oauth");

  return (
    <GoogleOAuthSetup
      message={check.message}
      missingEnvVars={check.missingEnvVars}
      status={check.status}
    />
  );
}
