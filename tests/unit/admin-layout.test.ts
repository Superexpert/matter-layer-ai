import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin layout", () => {
  it("uses shared Matter Layer layout and tab primitives", () => {
    const adminPageSource = readFileSync(
      join(process.cwd(), "app/app/admin/page.tsx"),
      "utf8",
    );
    const adminTabsSource = readFileSync(
      join(process.cwd(), "app/app/admin/AdminTabs.tsx"),
      "utf8",
    );

    expect(adminPageSource).toContain("admin-context-header");
    expect(adminPageSource).not.toContain("admin-header-panel");
    expect(adminPageSource).not.toContain("AppMainPanel");
    expect(adminTabsSource).toContain("AppTabs");
    expect(adminTabsSource).toContain("AppWorkspaceLayout");
    expect(adminTabsSource).toContain("AppMainPanel");
    expect(adminTabsSource).toContain("AppSidePanel");
    expect(adminTabsSource).toContain("Canvas");
    expect(adminTabsSource).not.toContain("border-b-2 border-[#5F4B76]");
  });
});
