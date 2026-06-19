"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    href: "/app/matters",
    label: "Matters",
    testId: "nav-matters",
  },
  {
    href: "/app/settings",
    label: "Settings",
    testId: "nav-settings",
  },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Application navigation"
      className="border-b border-zinc-200 bg-white"
      data-testid="global-app-nav"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-6 py-3 sm:px-8 lg:px-10">
        {navItems.map((item) => {
          const selected =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "bg-[#263326] px-4 py-2 text-sm font-semibold text-white"
                  : "px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
              }
              data-testid={item.testId}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
