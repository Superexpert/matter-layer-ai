import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { getAuthOptions } from "@/auth";

type RouteContext = {
  params: Promise<{
    nextauth: string[];
  }>;
};

export function GET(request: NextRequest, context: RouteContext) {
  return NextAuth(request, context, getAuthOptions());
}

export function POST(request: NextRequest, context: RouteContext) {
  return NextAuth(request, context, getAuthOptions());
}
