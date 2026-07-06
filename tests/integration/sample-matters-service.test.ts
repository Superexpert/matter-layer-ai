import { PrismaClient } from "@prisma/client";
import { readdir } from "node:fs/promises";
import { afterAll, beforeEach, expect, test } from "vitest";

import {
  createDefaultSampleMatters,
  DEFAULT_SAMPLE_MATTER_NAMES,
  SAMPLE_MATTER_DEFINITIONS,
  seedDefaultSampleMatterEvidence,
  seedDefaultSampleMattersIfNoMattersExist,
} from "../../services/matters/sample-matters-service";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.matterDocumentContent.deleteMany();
  await prisma.matterDocument.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.user.deleteMany();
});

test("fresh database with no matters gets the two sample matters", async () => {
  const user = await createUser();

  await seedDefaultSampleMattersIfNoMattersExist({
    uploadedByUserId: user.id,
  });

  await expect(listMatterNames()).resolves.toEqual(
    [...DEFAULT_SAMPLE_MATTER_NAMES].sort(),
  );
  await expectSampleDocumentsToMatchEvidenceFolders();
});

test("sample matter creation is idempotent", async () => {
  const user = await createUser();

  await createDefaultSampleMatters(prisma);
  await seedDefaultSampleMatterEvidence({
    uploadedByUserId: user.id,
  });
  await createDefaultSampleMatters(prisma);
  await seedDefaultSampleMatterEvidence({
    uploadedByUserId: user.id,
  });

  await expect(listMatterNames()).resolves.toEqual(
    [...DEFAULT_SAMPLE_MATTER_NAMES].sort(),
  );
  await expectSampleDocumentsToMatchEvidenceFolders();
});

test("first-install bootstrap does not modify existing real matters", async () => {
  const user = await createUser();

  await prisma.matter.create({
    data: {
      name: "Real User Matter",
    },
  });

  await seedDefaultSampleMattersIfNoMattersExist({
    uploadedByUserId: user.id,
  });

  await expect(listMatterNames()).resolves.toEqual(["Real User Matter"]);
  await expect(prisma.matterDocument.count()).resolves.toBe(0);
});

async function createUser() {
  return prisma.user.create({
    data: {
      email: `sample-matter-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "Sample Matter Seeder",
    },
  });
}

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

async function expectSampleDocumentsToMatchEvidenceFolders() {
  for (const definition of SAMPLE_MATTER_DEFINITIONS) {
    await expect(listSampleDocumentNames(definition.name)).resolves.toEqual(
      await listExpectedEvidenceFileNames(definition.evidenceDirectory),
    );
  }
}

async function listSampleDocumentNames(matterName: string) {
  const documents = await prisma.matterDocument.findMany({
    orderBy: {
      fileName: "asc",
    },
    select: {
      fileName: true,
    },
    where: {
      matter: {
        name: matterName,
      },
    },
  });

  return documents.map((document) => document.fileName);
}

async function listExpectedEvidenceFileNames(evidenceDirectory: string) {
  const fileNames = await readdir(evidenceDirectory);

  return fileNames
    .filter((fileName) => !fileName.startsWith("."))
    .sort();
}
