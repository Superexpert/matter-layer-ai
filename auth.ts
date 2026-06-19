import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { getMissingAuthEnvVars } from "@/lib/auth/env";

export { getMissingAuthEnvVars } from "@/lib/auth/env";

export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("Missing required environment variable: AUTH_SECRET");
  }

  return secret;
}

export function getAuthOptions(): NextAuthOptions {
  const missingEnvVars = getMissingAuthEnvVars();

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required authentication environment variables: ${missingEnvVars.join(
        ", ",
      )}`,
    );
  }

  return {
    providers: [
      GoogleProvider({
        clientId: process.env.AUTH_GOOGLE_ID!,
        clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      }),
    ],
    pages: {
      signIn: "/login",
      error: "/login",
    },
    secret: getAuthSecret(),
    session: {
      strategy: "jwt",
    },
    callbacks: {
      signIn({ account, profile }) {
        if (account?.provider !== "google") {
          return false;
        }

        if (!profile) {
          return false;
        }

        const googleProfile = profile as { email_verified?: boolean };

        return googleProfile.email_verified === true;
      },
    },
  };
}

export async function auth() {
  return getServerSession(getAuthOptions());
}
