"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/app/components/SignOutButton";

import { AppContainer } from "./app-container";

const navItems = [
  {
    href: "/app/settings",
    label: "Settings",
    testId: "nav-settings",
  },
];

export function AppNav() {
  const pathname = usePathname();
  const pathSegments = pathname.split("/").filter(Boolean);
  const isMatterDetailRoute =
    pathSegments[0] === "app" &&
    pathSegments[1] === "matters" &&
    pathSegments.length >= 3;

  if (isMatterDetailRoute) {
    return null;
  }

  return (
    <nav
      aria-label="Application navigation"
      className="border-b border-[#312342] bg-[#42305B]"
      data-testid="global-app-nav"
    >
      <AppContainer className="flex h-14 items-center justify-between">
        <Link
          className="text-sm font-semibold tracking-[0.01em] text-white"
          href="/app/matters"
        >
          Matter Layer
        </Link>
        <div className="flex items-center gap-1">
          {navItems.map((item) => {
            const selected =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                aria-current={selected ? "page" : undefined}
                className={
                  selected
                    ? "rounded-lg bg-white/14 px-3 py-2 text-sm font-semibold text-white"
                    : "rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] hover:bg-white/10 hover:text-white"
                }
                data-testid={item.testId}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
          <SignOutButton />
        </div>
      </AppContainer>
    </nav>
  );
}
