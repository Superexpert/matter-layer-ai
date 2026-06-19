import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getSetupStatusFromEnv,
  SETUP_AREA_ROUTES,
} from "./services/setup/setup-status";

const publicRoutes = new Set([
  "/",
  "/google-oauth",
  "/login",
  "/setup/ai-provider",
  "/setup/database",
  "/setup/google-oauth",
]);

export async function proxy(request: NextRequest) {
  const setupStatus = getSetupStatusFromEnv();
  const { pathname } = request.nextUrl;

  if (!setupStatus.ready) {
    if (publicRoutes.has(pathname)) {
      return NextResponse.next();
    }

    return NextResponse.redirect(
      new URL(SETUP_AREA_ROUTES[setupStatus.firstBlockingArea!], request.url),
    );
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });

  if (token) {
    return NextResponse.next();
  }

  if (publicRoutes.has(pathname)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", request.nextUrl.href);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
