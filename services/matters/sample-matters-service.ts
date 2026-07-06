import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const DEFAULT_SAMPLE_MATTER_NAMES = [
  "Criminal Matter (Sample)",
  "Eminent Domain Matter (Sample)",
] as const;

type MatterWriter = Pick<PrismaClient, "matter"> | Prisma.TransactionClient;

export async function createDefaultSampleMatters(
  client: MatterWriter = prisma,
) {
  const existingSampleMatters = await client.matter.findMany({
    select: {
      name: true,
    },
    where: {
      name: {
        in: [...DEFAULT_SAMPLE_MATTER_NAMES],
      },
    },
  });
  const existingSampleMatterNames = new Set(
    existingSampleMatters.map((matter) => matter.name),
  );
  const missingSampleMatterNames = DEFAULT_SAMPLE_MATTER_NAMES.filter(
    (name) => !existingSampleMatterNames.has(name),
  );

  if (missingSampleMatterNames.length === 0) {
    return;
  }

  await client.matter.createMany({
    data: missingSampleMatterNames.map((name) => ({
      name,
    })),
  });
}

export async function seedDefaultSampleMattersIfNoMattersExist() {
  return prisma.$transaction(async (tx) => {
    const matterCount = await tx.matter.count();

    if (matterCount > 0) {
      return;
    }

    await createDefaultSampleMatters(tx);
  });
}
