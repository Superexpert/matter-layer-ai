"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      className="inline-flex h-11 items-center justify-center border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-100"
      onClick={() => signOut({ callbackUrl: "/login" })}
      type="button"
    >
      Sign out
    </button>
  );
}
