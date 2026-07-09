"use client";

type AppTabOption<TTab extends string> = {
  label: string;
  testId: string;
  value: TTab;
};

type AppTabsProps<TTab extends string> = {
  ariaLabel: string;
  onSelect: (tab: TTab) => void;
  selectedTab: TTab;
  tabs: readonly AppTabOption<TTab>[];
  testId: string;
};

export function AppTabs<TTab extends string>({
  ariaLabel,
  onSelect,
  selectedTab,
  tabs,
  testId,
}: AppTabsProps<TTab>) {
  return (
    <nav
      aria-label={ariaLabel}
      className="border-b border-[#E3DEEA] bg-white"
      data-testid={testId}
    >
      <div className="flex h-11 items-center">
        {tabs.map((tab, index) => {
          const tabPaddingClassName = index === 0 ? "pr-4" : "px-4";

          return (
            <button
              aria-current={tab.value === selectedTab ? "page" : undefined}
              className={
                tab.value === selectedTab
                  ? `inline-flex h-11 items-center border-b-2 border-[#5F4B76] text-sm font-semibold text-[#4B3861] ${tabPaddingClassName}`
                  : `inline-flex h-11 items-center border-b-2 border-transparent text-sm font-medium text-[#74677F] transition-colors hover:text-[#211B27] ${tabPaddingClassName}`
              }
              data-testid={tab.testId}
              key={tab.value}
              onClick={() => onSelect(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
