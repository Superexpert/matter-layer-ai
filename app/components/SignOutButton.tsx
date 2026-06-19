"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      className="rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8E2F0]"
      data-testid="logout-button"
      onClick={() => {
        void signOut({ callbackUrl: "/login" });
      }}
      type="button"
    >
      Log out
    </button>
  );
}
