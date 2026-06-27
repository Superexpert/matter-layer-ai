import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const forbiddenImportPatterns = [
  /from\s+["']@prisma\/client["']/,
  /from\s+["']@\/lib\/prisma["']/,
  /from\s+["'].*\/lib\/prisma["']/,
  /new\s+PrismaClient\s*\(/,
];

function workflowStepFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return workflowStepFiles(absolutePath);
    }

    return /\.(ts|tsx)$/.test(entry) ? [absolutePath] : [];
  });
}

describe("workflow step plugin persistence boundary", () => {
  it("does not allow workflow-step plugins to import Prisma directly", () => {
    const pluginFiles = workflowStepFiles(join(process.cwd(), "workflow-steps"));
    const violations = pluginFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return forbiddenImportPatterns.some((pattern) => pattern.test(source));
    });

    expect(violations.map((file) => file.replace(`${process.cwd()}/`, ""))).toEqual([]);
  });
});
