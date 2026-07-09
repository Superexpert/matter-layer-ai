"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { SignOutButton } from "@/app/components/SignOutButton";
import { AppContainer } from "@/components/app-container";

export type MatterTab = "Workflows" | "Case Files" | "Work Products" | "Chat";

export const MATTER_TABS = ["Workflows", "Case Files", "Work Products"] as const;

export function matterTabTestId(tab: MatterTab) {
  return `matter-tab-${tab.toLowerCase().replace(/\s+/g, "-")}`;
}

type MatterDetailShellProps = {
  activeTab: MatterTab;
  children: ReactNode;
  isAdmin: boolean;
  matterId: string;
  matterName: string;
  onSelectTab?: (tab: MatterTab) => void;
  rootClassName?: string;
  testId?: string;
};

function tabHref(matterId: string, tab: MatterTab) {
  if (tab === "Work Products") {
    return `/app/matters/${matterId}?tab=work-products`;
  }

  if (tab === "Case Files") {
    return `/app/matters/${matterId}?tab=case-files`;
  }

  return `/app/matters/${matterId}`;
}

export function MatterDetailShell({
  activeTab,
  children,
  isAdmin,
  matterId,
  matterName,
  onSelectTab,
  rootClassName = "min-h-screen bg-[#F7F6FA] text-[#211B27]",
  testId,
}: MatterDetailShellProps) {
  return (
    <section className={rootClassName} data-testid={testId}>
      <header
        className="border-b border-[#312342] bg-[#42305B]"
        data-testid="matter-workspace-header"
      >
        <AppContainer className="flex h-14 items-center justify-between gap-4">
          <Link
            className="shrink-0 text-sm font-semibold tracking-[0.01em] text-white"
            href="/app/matters"
          >
            Matter Layer
          </Link>
          <div className="flex items-center gap-1">
            {isAdmin ? (
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] hover:bg-white/10 hover:text-white"
                data-testid="nav-admin"
                href="/app/admin"
              >
                Admin
              </Link>
            ) : null}
            <Link
              className="rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] hover:bg-white/10 hover:text-white"
              data-testid="nav-settings"
              href="/app/settings"
            >
              Settings
            </Link>
            <SignOutButton />
          </div>
        </AppContainer>
      </header>

      <nav
        aria-label="Breadcrumb"
        className="border-b border-[#E3DEEA] bg-white"
        data-testid="matter-breadcrumb"
      >
        <AppContainer>
          <ol className="flex h-10 items-center gap-2 text-sm">
            <li>
              <Link
                className="font-medium text-[#5F4B76] hover:text-[#42305B]"
                data-testid="breadcrumb-home"
                href="/app/matters"
              >
                Matters
              </Link>
            </li>
            <li aria-hidden="true" className="text-[#A79AB4]">
              /
            </li>
            <li
              aria-current="page"
              className="truncate font-semibold text-[#211B27]"
              data-testid="breadcrumb-current-matter"
            >
              {matterName}
            </li>
          </ol>
        </AppContainer>
      </nav>

      <nav
        aria-label="Matter navigation"
        className="border-b border-[#E3DEEA] bg-white"
        data-testid="matter-tabs"
      >
        <AppContainer className="flex h-11 items-center">
          {MATTER_TABS.map((tab, index) => {
            const tabClassName =
              tab === activeTab
                ? "h-11 border-b-2 border-[#5F4B76] pr-4 text-sm font-semibold text-[#4B3861]"
                : `h-11 text-sm font-medium text-[#74677F] transition-colors hover:text-[#211B27] ${
                    index === 0 ? "pr-4" : "px-4"
                  }`;

            if (onSelectTab) {
              return (
                <button
                  aria-current={tab === activeTab ? "page" : undefined}
                  className={tabClassName}
                  data-testid={matterTabTestId(tab)}
                  key={tab}
                  onClick={() => onSelectTab(tab)}
                  type="button"
                >
                  {tab}
                </button>
              );
            }

            return (
              <Link
                aria-current={tab === activeTab ? "page" : undefined}
                className={tabClassName}
                data-testid={matterTabTestId(tab)}
                href={tabHref(matterId, tab)}
                key={tab}
              >
                {tab}
              </Link>
            );
          })}
        </AppContainer>
      </nav>

      {children}
    </section>
  );
}
