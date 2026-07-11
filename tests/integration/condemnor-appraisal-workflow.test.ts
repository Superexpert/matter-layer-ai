import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, expect, test } from "vitest";

import { syncBuiltInWorkflows } from "../../services/workflows/catalog-service";

const prisma = new PrismaClient();
afterAll(async () => prisma.$disconnect());
beforeEach(async () => prisma.workflow.deleteMany());

test("Condemnor Appraisal Review built-in reseeding is idempotent", async () => {
  await syncBuiltInWorkflows();
  await syncBuiltInWorkflows();
  const rows = await prisma.workflow.findMany({ where: { slug: "condemnor-appraisal-review" } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ builtInVersion: 1, isEnabled: true, name: "Condemnor Appraisal Review" });
  expect(rows[0]?.definitionJson).toMatchObject({ category: "Eminent Domain" });
});
