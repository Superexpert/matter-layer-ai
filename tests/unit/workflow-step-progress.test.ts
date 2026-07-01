import { describe, expect, it } from "vitest";

import {
  progressPercent,
  progressPercentFromItems,
  progressPercentWithActiveItem,
} from "../../services/workflows/workflow-step-progress";

describe("workflow step progress", () => {
  it("calculates bounded integer percentages", () => {
    expect(progressPercent(0, 3)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
    expect(progressPercent(3, 3)).toBe(100);
    expect(progressPercent(4, 3)).toBe(100);
    expect(progressPercent(1, 0)).toBe(0);
  });

  it("includes active item phase progress in the global percentage", () => {
    expect(
      progressPercentWithActiveItem({
        activeItemPercent: 40,
        completedItems: 0,
        totalItems: 2,
      }),
    ).toBe(20);
    expect(
      progressPercentWithActiveItem({
        activeItemPercent: 75,
        completedItems: 0,
        totalItems: 2,
      }),
    ).toBe(38);
    expect(
      progressPercentWithActiveItem({
        activeItemPercent: 75,
        completedItems: 1,
        totalItems: 2,
      }),
    ).toBe(88);
  });

  it("calculates progress from waiting, running, and completed items", () => {
    expect(
      progressPercentFromItems([
        {
          id: "doc_1",
          label: "Report.pdf",
          phase: "extracting",
          percentComplete: 75,
          status: "running",
        },
        {
          id: "doc_2",
          label: "Notes.txt",
          phase: "queued",
          percentComplete: 0,
          status: "waiting",
        },
      ]),
    ).toBe(38);
  });

  it("keeps document two waiting while document one is running", () => {
    const items = [
      {
        id: "doc_1",
        label: "Incident Report.pdf",
        phase: "converting" as const,
        percentComplete: 40,
        status: "running" as const,
      },
      {
        id: "doc_2",
        label: "Supplemental Report.pdf",
        phase: "queued" as const,
        percentComplete: 0,
        status: "waiting" as const,
      },
    ];

    expect(items[0]).toMatchObject({
      phase: "converting",
      status: "running",
    });
    expect(items[1]).toMatchObject({
      phase: "queued",
      status: "waiting",
    });
    expect(progressPercentFromItems(items)).toBe(20);
  });
});
