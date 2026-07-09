import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("workflow work product navigation", () => {
  it("adds in-page anchors for multiple generated work products on review surfaces", () => {
    const workflowRunReviewSource = readFileSync(
      join(
        process.cwd(),
        "app/app/matters/[matterId]/workflow-runs/[workflowRunId]/WorkflowRunDetailsClient.tsx",
      ),
      "utf8",
    );
    const reviewStepSource = readFileSync(
      join(process.cwd(), "workflow-steps/review-work-products/component.tsx"),
      "utf8",
    );

    for (const source of [workflowRunReviewSource, reviewStepSource]) {
      expect(source).toContain("Work products:");
      expect(source).toContain("aria-label=\"Generated work products\"");
      expect(source).toContain("workProductAnchorId(artifact.artifactId)");
      expect(source).toContain("scroll-mt-6");
      expect(source).toContain("href={`#${workProductAnchorId(artifact.artifactId)}`}");
    }

    expect(workflowRunReviewSource).toContain("editableArtifacts.length > 1");
    expect(reviewStepSource).toContain("editableWorkProducts.length > 1");
    expect(workflowRunReviewSource).toContain(
      'data-testid="workflow-run-work-product-navigation"',
    );
    expect(reviewStepSource).toContain(
      'data-testid="review-work-products-navigation"',
    );
  });
});
