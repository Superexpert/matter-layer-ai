import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  MatterDocumentSourceType,
  PrismaClient,
  UserRole,
  WorkflowArtifactType,
} from "@prisma/client";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

import { DEFAULT_SAMPLE_MATTER_NAMES } from "../../services/matters/sample-matters-service";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock,
}));

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  authMock.mockReset();
  await deleteMatterRuntimeData();
  await prisma.aiProviderConfig.deleteMany();
  await prisma.appSettings.deleteMany({
    where: {
      id: "app",
    },
  });
  await prisma.user.deleteMany();
});

test("reset rejects non-admin users", async () => {
  const admin = await createUser("reset-admin@example.com", UserRole.ADMIN);
  const user = await createUser("reset-user@example.com", UserRole.USER);
  await seedMatterRuntimeData(admin.id);
  authMock.mockResolvedValue({
    user: {
      email: user.email,
      name: user.name,
    },
  });

  const { resetMatterLayerApplication } = await import(
    "../../services/admin/application-reset-service"
  );

  await expect(
    resetMatterLayerApplication({
      confirmationPhrase: "RESET MATTER LAYER",
    }),
  ).rejects.toThrow("Admin access is required.");
  await expect(
    prisma.matter.findFirst({
      where: {
        name: "Reset Fixture Matter",
      },
    }),
  ).resolves.toMatchObject({
    name: "Reset Fixture Matter",
  });
});

test("reset rejects an incorrect confirmation phrase", async () => {
  const admin = await createUser("reset-admin@example.com", UserRole.ADMIN);
  await seedMatterRuntimeData(admin.id);
  authMock.mockResolvedValue({
    user: {
      email: admin.email,
      name: admin.name,
    },
  });

  const { resetMatterLayerApplication } = await import(
    "../../services/admin/application-reset-service"
  );

  await expect(
    resetMatterLayerApplication({
      confirmationPhrase: "RESET",
    }),
  ).rejects.toThrow("The confirmation phrase is incorrect.");
  await expect(
    prisma.matter.findFirst({
      where: {
        name: "Reset Fixture Matter",
      },
    }),
  ).resolves.toMatchObject({
    name: "Reset Fixture Matter",
  });
});

test("successful reset deletes matter data and preserves admin auth and AI settings", async () => {
  const admin = await createUser("reset-admin@example.com", UserRole.ADMIN);
  const aiProvider = await prisma.aiProviderConfig.create({
    data: {
      isActive: true,
      model: "gpt-test",
      provider: "openai",
    },
  });
  await prisma.appSettings.create({
    data: {
      aiModel: "gpt-test",
      aiProvider: "openai",
      id: "app",
    },
  });
  await seedMatterRuntimeData(admin.id);
  authMock.mockResolvedValue({
    user: {
      email: admin.email,
      name: admin.name,
    },
  });

  const { resetMatterLayerApplication } = await import(
    "../../services/admin/application-reset-service"
  );

  await resetMatterLayerApplication({
    confirmationPhrase: "RESET MATTER LAYER",
  });

  await expect(prisma.workflowRunStepActivity.count()).resolves.toBe(0);
  await expect(prisma.workflowRunStepFile.count()).resolves.toBe(0);
  await expect(prisma.workflowRunStepOutput.count()).resolves.toBe(0);
  await expect(prisma.workflowArtifactRevision.count()).resolves.toBe(0);
  await expect(prisma.workflowArtifact.count()).resolves.toBe(0);
  await expect(prisma.workflowExtractionRun.count()).resolves.toBe(0);
  await expect(prisma.workflowRun.count()).resolves.toBe(0);
  await expect(prisma.matterDocumentRepresentation.count()).resolves.toBe(0);
  await expect(prisma.matterDocumentContent.count()).resolves.toBe(0);
  await expect(prisma.matterDocument.count()).resolves.toBe(0);
  await expect(prisma.matter.count()).resolves.toBe(2);
  await expect(
    prisma.matter.findMany({
      orderBy: {
        name: "asc",
      },
      select: {
        name: true,
      },
    }),
  ).resolves.toEqual(
    [...DEFAULT_SAMPLE_MATTER_NAMES].sort().map((name) => ({
      name,
    })),
  );

  await expect(
    prisma.user.findUnique({
      where: {
        id: admin.id,
      },
    }),
  ).resolves.toMatchObject({
    email: admin.email,
    role: UserRole.ADMIN,
  });
  await expect(
    prisma.aiProviderConfig.findUnique({
      where: {
        id: aiProvider.id,
      },
    }),
  ).resolves.toMatchObject({
    model: "gpt-test",
    provider: "openai",
  });
  await expect(
    prisma.appSettings.findUnique({
      where: {
        id: "app",
      },
    }),
  ).resolves.toMatchObject({
    aiModel: "gpt-test",
    aiProvider: "openai",
  });
});

async function createUser(email: string, role: UserRole) {
  return prisma.user.create({
    data: {
      email,
      name: email,
      role,
    },
  });
}

async function seedMatterRuntimeData(userId: string) {
  const matter = await prisma.matter.create({
    data: {
      name: "Reset Fixture Matter",
    },
  });
  const document = await prisma.matterDocument.create({
    data: {
      fileName: "reset-fixture.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      size: 13,
      sourceType: MatterDocumentSourceType.upload,
      uploadedByUserId: userId,
    },
  });
  await prisma.matterDocumentContent.create({
    data: {
      bytes: Buffer.from("Reset fixture"),
      matterDocumentId: document.id,
    },
  });
  await prisma.matterDocumentRepresentation.create({
    data: {
      content: "Reset fixture markdown",
      matterDocumentId: document.id,
      status: MatterDocumentRepresentationStatus.READY,
      type: MatterDocumentRepresentationType.MARKDOWN,
    },
  });
  const workflowRun = await prisma.workflowRun.create({
    data: {
      id: `reset-run-${Date.now()}`,
      matterId: matter.id,
      workflowDefinitionId: "chronology",
    },
  });
  await prisma.workflowRunStepOutput.create({
    data: {
      outputJson: {
        result: "ok",
      },
      stepId: "extract",
      workflowRunId: workflowRun.id,
    },
  });
  await prisma.workflowRunStepActivity.create({
    data: {
      code: "reset.fixture",
      level: "info",
      message: "Fixture activity",
      stepId: "extract",
      workflowRunId: workflowRun.id,
    },
  });
  await prisma.workflowRunStepFile.create({
    data: {
      matterDocumentId: document.id,
      selectedByUserId: userId,
      selectionSource: "manual",
      stepId: "extract",
      workflowRunId: workflowRun.id,
    },
  });
  await prisma.workflowExtractionRun.create({
    data: {
      matterId: matter.id,
      profile: "chronology",
      stepId: "extract",
      workflowRunId: workflowRun.id,
    },
  });
  const artifact = await prisma.workflowArtifact.create({
    data: {
      content: "Artifact content",
      matterId: matter.id,
      stepId: "extract",
      title: "Artifact",
      type: WorkflowArtifactType.MARKDOWN,
      workflowRunId: workflowRun.id,
    },
  });
  const revision = await prisma.workflowArtifactRevision.create({
    data: {
      artifactId: artifact.id,
      content: "Revision content",
      createdByUserId: userId,
      matterId: matter.id,
      stepId: "extract",
      workflowRunId: workflowRun.id,
    },
  });
  await prisma.workflowArtifact.update({
    data: {
      currentRevisionId: revision.id,
    },
    where: {
      id: artifact.id,
    },
  });
}

async function deleteMatterRuntimeData() {
  await prisma.workflowArtifact.updateMany({
    data: {
      currentRevisionId: null,
    },
  });
  await prisma.workflowRunStepActivity.deleteMany();
  await prisma.workflowRunStepFile.deleteMany();
  await prisma.workflowRunStepOutput.deleteMany();
  await prisma.workflowArtifactRevision.deleteMany();
  await prisma.workflowArtifact.deleteMany();
  await prisma.workflowExtractionRun.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.matterDocumentRepresentation.deleteMany();
  await prisma.matterDocumentContent.deleteMany();
  await prisma.matterDocument.deleteMany();
  await prisma.matter.deleteMany();
}
