import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("matter workflows page copy", () => {
  it("uses lawyer-friendly workflow panel language", () => {
    const source = readFileSync(
      join(process.cwd(), "app/app/matters/[matterId]/MatterChat.tsx"),
      "utf8",
    );

    expect(source).toContain("Start a guided process for this matter.");
    expect(source).toContain('workflow.id === "workflow-builder"');
    expect(source).toContain('return "Workflow";');
    expect(source).not.toContain("The canvas tracks");
    expect(source).not.toContain(">Canvas<");
  });
});
