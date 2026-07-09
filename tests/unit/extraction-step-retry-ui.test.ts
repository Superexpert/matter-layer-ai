import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("extraction step retry and continue UI", () => {
  it("hides autorun continue during normal progress and exposes retry/continue for failures", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "workflow-steps/extraction/component.tsx"),
      "utf8",
    );
    const serviceSource = readFileSync(
      join(process.cwd(), "services/workflow-steps/extraction-step-service.ts"),
      "utf8",
    );

    expect(componentSource).toContain('executionMode: "autorun" | "manual" | "retry_failed"');
    expect(componentSource).toContain("shouldShowErrorActions");
    expect(componentSource).toContain('data-testid="extraction-retry"');
    expect(componentSource).toContain('void prepareDocuments("retry_failed")');
    expect(componentSource).toContain("step.autorun && hasFailedDocuments");
    expect(componentSource).toContain("!step.autorun && latestOutput?.status === \"completed\"");
    expect(componentSource).not.toContain("disabled={!canContinue}");
    expect(serviceSource).toContain("retryProgressItemsForDocuments");
    expect(serviceSource).toContain('input.executionMode === "retry_failed"');
    expect(serviceSource).toContain("previousOutput.failedDocumentIds");
  });
});
