"use client";

import { signIn } from "next-auth/react";

export function GoogleSignInButton() {
  return (
    <button
      className="inline-flex h-11 items-center justify-center bg-[#263326] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#344734]"
      onClick={() => signIn("google", { callbackUrl: "/" })}
      type="button"
    >
      Sign in with Google
    </button>
  );
}
