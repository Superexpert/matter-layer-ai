import path from "node:path";

import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("sample matters service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("resolves sample evidence folders from the project root", async () => {
    const { SAMPLE_MATTER_DEFINITIONS } = await import(
      "../../services/matters/sample-matters-service"
    );

    expect(SAMPLE_MATTER_DEFINITIONS).toEqual([
      {
        evidenceDirectory: path.join(process.cwd(), "sample-evidence", "criminal"),
        name: "Criminal Matter (Sample)",
      },
      {
        evidenceDirectory: path.join(
          process.cwd(),
          "sample-evidence",
          "eminent-domain",
        ),
        name: "Eminent Domain Matter (Sample)",
      },
    ]);
  });

  it("includes appraisal-review demonstration evidence in the Eminent Domain sample", async () => {
    const files = await readdir(path.join(process.cwd(), "sample-evidence", "eminent-domain"));
    expect(files).toEqual(expect.arrayContaining([
      "2026-02-05 Condemnor Appraisal Summary - Parcel 14.pdf",
      "2026-03-18 Exhibit B Parcel Plat Summary.pdf",
      "2026-03-04 Owner Response Email re Access and Parking.pdf",
    ]));
  });

  it("does not crash when sample evidence is missing", async () => {
    vi.doMock("node:fs/promises", () => ({
      readdir: vi.fn(async () => {
        throw new Error("missing directory");
      }),
      readFile: vi.fn(),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { SAMPLE_MATTER_DEFINITIONS, seedSampleMatterEvidence } = await import(
      "../../services/matters/sample-matters-service"
    );

    await expect(
      seedSampleMatterEvidence({
        definition: SAMPLE_MATTER_DEFINITIONS[1],
        matterId: "matter_1",
        uploadedByUserId: "user_1",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Sample evidence directory is missing or unreadable.",
      expect.objectContaining({
        directory: path.join(process.cwd(), "sample-evidence", "eminent-domain"),
        matterName: "Eminent Domain Matter (Sample)",
      }),
    );
  });

  it("does not crash when sample evidence is empty", async () => {
    vi.doMock("node:fs/promises", () => ({
      readdir: vi.fn(async () => []),
      readFile: vi.fn(),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { SAMPLE_MATTER_DEFINITIONS, seedSampleMatterEvidence } = await import(
      "../../services/matters/sample-matters-service"
    );

    await expect(
      seedSampleMatterEvidence({
        definition: SAMPLE_MATTER_DEFINITIONS[0],
        matterId: "matter_1",
        uploadedByUserId: "user_1",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Sample evidence directory is empty.",
      expect.objectContaining({
        directory: path.join(process.cwd(), "sample-evidence", "criminal"),
        matterName: "Criminal Matter (Sample)",
      }),
    );
  });
});
