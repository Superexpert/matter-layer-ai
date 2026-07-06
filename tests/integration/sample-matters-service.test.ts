import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, expect, test } from "vitest";

import {
  createDefaultSampleMatters,
  DEFAULT_SAMPLE_MATTER_NAMES,
  seedDefaultSampleMattersIfNoMattersExist,
} from "../../services/matters/sample-matters-service";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.matter.deleteMany();
});

test("fresh database with no matters gets the two sample matters", async () => {
  await seedDefaultSampleMattersIfNoMattersExist();

  await expect(listMatterNames()).resolves.toEqual(
    [...DEFAULT_SAMPLE_MATTER_NAMES].sort(),
  );
});

test("sample matter creation is idempotent", async () => {
  await createDefaultSampleMatters();
  await createDefaultSampleMatters();

  await expect(listMatterNames()).resolves.toEqual(
    [...DEFAULT_SAMPLE_MATTER_NAMES].sort(),
  );
});

test("first-install bootstrap does not modify existing real matters", async () => {
  await prisma.matter.create({
    data: {
      name: "Real User Matter",
    },
  });

  await seedDefaultSampleMattersIfNoMattersExist();

  await expect(listMatterNames()).resolves.toEqual(["Real User Matter"]);
});

async function listMatterNames() {
  const matters = await prisma.matter.findMany({
    orderBy: {
      name: "asc",
    },
    select: {
      name: true,
    },
  });

  return matters.map((matter) => matter.name);
}
