import type { ReactNode } from "react";

type AppWorkspaceLayoutProps = {
  children: ReactNode;
  className?: string;
  sidebar: ReactNode;
  testId?: string;
};

type AppWorkspacePanelProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function AppWorkspaceLayout({
  children,
  className,
  sidebar,
  testId,
}: AppWorkspaceLayoutProps) {
  return (
    <div
      className={[
        "grid min-h-0 grid-rows-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]",
        className,
      ].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      {children}
      {sidebar}
    </div>
  );
}

export function AppMainPanel({
  children,
  className,
  testId,
}: AppWorkspacePanelProps) {
  return (
    <section
      className={[
        "min-h-0 rounded-[14px] border border-[#E3DEEA] bg-white shadow-[0_1px_2px_rgba(40,29,52,0.05)]",
        className,
      ].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      {children}
    </section>
  );
}

export function AppSidePanel({
  children,
  className,
  testId,
}: AppWorkspacePanelProps) {
  return (
    <aside
      className={[
        "h-full min-h-0 overflow-y-auto rounded-[14px] border border-[#E3DEEA] bg-white p-4 shadow-[0_1px_2px_rgba(40,29,52,0.05)]",
        className,
      ].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      {children}
    </aside>
  );
}
