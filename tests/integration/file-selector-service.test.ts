import {
  MatterDocumentSourceType,
  PrismaClient,
} from "@prisma/client";
import { afterAll, expect, test } from "vitest";

import {
  loadFileSelectorStepState,
  saveFileSelectorStepSelection,
  uploadMatterDocuments,
} from "../../workflow-steps/file-selector/server";
import { defaultFileSelectorConfig } from "../../workflow-steps/file-selector/schema";
import {
  getMatterDocumentStorageProvider,
  readMatterDocumentFile,
} from "../../services/matter-documents/storage";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(email: string) {
  return prisma.user.upsert({
    create: {
      email,
      name: "Test Lawyer",
    },
    update: {},
    where: {
      email,
    },
  });
}

async function cleanupMatters(matterIds: string[]) {
  await prisma.workflowRunStepFile.deleteMany({
    where: {
      workflowRun: {
        matterId: {
          in: matterIds,
        },
      },
    },
  });
  await prisma.workflowRunStepOutput.deleteMany({
    where: {
      workflowRun: {
        matterId: {
          in: matterIds,
        },
      },
    },
  });
  await prisma.extractedFact.deleteMany({
    where: {
      matterId: {
        in: matterIds,
      },
    },
  });
  await prisma.workflowExtractionRun.deleteMany({
    where: {
      matterId: {
        in: matterIds,
      },
    },
  });
  await prisma.workflowRun.deleteMany({
    where: {
      matterId: {
        in: matterIds,
      },
    },
  });
  await prisma.matterDocument.deleteMany({
    where: {
      matterId: {
        in: matterIds,
      },
    },
  });
  await prisma.matter.deleteMany({
    where: {
      id: {
        in: matterIds,
      },
    },
  });
}

function restoreEnv(input: {
  maxUploadMb: string | undefined;
  storageProvider: string | undefined;
  storageRoot?: string | undefined;
}) {
  if (input.storageProvider === undefined) {
    delete process.env.MATTER_FILE_STORAGE_PROVIDER;
  } else {
    process.env.MATTER_FILE_STORAGE_PROVIDER = input.storageProvider;
  }

  if (input.storageRoot !== undefined) {
    process.env.MATTER_FILE_STORAGE_ROOT = input.storageRoot;
  } else {
    delete process.env.MATTER_FILE_STORAGE_ROOT;
  }

  if (input.maxUploadMb === undefined) {
    delete process.env.MATTER_FILE_MAX_UPLOAD_MB;
  } else {
    process.env.MATTER_FILE_MAX_UPLOAD_MB = input.maxUploadMb;
  }
}

test("File Selector rejects selections containing documents from another matter", async () => {
  const user = await createUser("cross-matter-lawyer@example.com");
  const [matter, otherMatter] = await Promise.all([
    prisma.matter.create({
      data: {
        name: `Allowed Matter ${Date.now()}`,
      },
    }),
    prisma.matter.create({
      data: {
        name: `Other Matter ${Date.now()}`,
      },
    }),
  ]);
  const otherMatterDocument = await prisma.matterDocument.create({
    data: {
      fileName: "other-matter.txt",
      matterId: otherMatter.id,
      mimeType: "text/plain",
      size: 12,
      sourceType: MatterDocumentSourceType.upload,
      storageProvider: "database",
      storageKey: null,
      uploadedByUserId: user.id,
    },
  });

  try {
    await expect(
      saveFileSelectorStepSelection({
        config: defaultFileSelectorConfig,
        matterId: matter.id,
        selectedMatterDocumentIds: [otherMatterDocument.id],
        stepId: "select-source-files",
        uploadedDuringStepMatterDocumentIds: [],
        userId: user.id,
        workflowDefinitionId: "chronology",
        workflowRunId: `test-run-${Date.now()}`,
      }),
    ).rejects.toThrow("Every selected document must belong to the workflow run matter.");
  } finally {
    await cleanupMatters([matter.id, otherMatter.id]);
  }
});

test("matter document storage defaults to database and keeps list queries metadata-only", async () => {
  const previousStorageProvider = process.env.MATTER_FILE_STORAGE_PROVIDER;
  const previousMaxUploadMb = process.env.MATTER_FILE_MAX_UPLOAD_MB;

  delete process.env.MATTER_FILE_STORAGE_PROVIDER;
  delete process.env.MATTER_FILE_MAX_UPLOAD_MB;

  const user = await createUser("db-storage-lawyer@example.com");
  const matter = await prisma.matter.create({
    data: {
      name: `DB Storage Matter ${Date.now()}`,
    },
  });

  try {
    expect(getMatterDocumentStorageProvider().provider).toBe("database");

    const [document] = await uploadMatterDocuments({
      config: defaultFileSelectorConfig,
      files: [
        new File([Buffer.from("database stored file")], "database-file.txt", {
          type: "text/plain",
        }),
      ],
      matterId: matter.id,
      userId: user.id,
    });

    expect(document?.storageProvider).toBe("database");

    const metadata = await prisma.matterDocument.findUniqueOrThrow({
      where: {
        id: document!.id,
      },
    });
    const metadataKeys = Object.keys(metadata);

    expect(metadata.storageProvider).toBe("database");
    expect(metadata.storageKey).toBeNull();
    expect(metadata.sha256).toHaveLength(64);
    expect(metadataKeys).not.toContain("bytes");

    const content = await prisma.matterDocumentContent.findUniqueOrThrow({
      where: {
        matterDocumentId: document!.id,
      },
    });

    expect(Buffer.from(content.bytes)).toEqual(Buffer.from("database stored file"));

    const stepState = await loadFileSelectorStepState({
      matterId: matter.id,
      stepId: "select-source-files",
      workflowRunId: `list-run-${Date.now()}`,
    });
    const listedDocument = stepState.documents.find(
      (candidate) => candidate.id === document!.id,
    );

    expect(listedDocument).toMatchObject({
      fileName: "database-file.txt",
      storageProvider: "database",
    });
    expect(Object.keys(listedDocument ?? {})).not.toContain("bytes");

    const readFile = await readMatterDocumentFile({
      matterDocumentId: document!.id,
      matterId: matter.id,
    });

    expect(readFile.bytes).toEqual(Buffer.from("database stored file"));

    const otherMatter = await prisma.matter.create({
      data: {
        name: `Other Read Matter ${Date.now()}`,
      },
    });

    try {
      await expect(
        readMatterDocumentFile({
          matterDocumentId: document!.id,
          matterId: otherMatter.id,
        }),
      ).rejects.toThrow("Matter document was not found for this matter.");
    } finally {
      await cleanupMatters([otherMatter.id]);
    }
  } finally {
    restoreEnv({
      maxUploadMb: previousMaxUploadMb,
      storageProvider: previousStorageProvider,
    });

    await cleanupMatters([matter.id]);
  }
});

test("matter document upload limit defaults to 25 MB and can be overridden", async () => {
  const previousStorageProvider = process.env.MATTER_FILE_STORAGE_PROVIDER;
  const previousMaxUploadMb = process.env.MATTER_FILE_MAX_UPLOAD_MB;

  delete process.env.MATTER_FILE_STORAGE_PROVIDER;
  delete process.env.MATTER_FILE_MAX_UPLOAD_MB;

  const user = await createUser("limit-lawyer@example.com");
  const matter = await prisma.matter.create({
    data: {
      name: `Upload Limit Matter ${Date.now()}`,
    },
  });

  try {
    await expect(
      uploadMatterDocuments({
        config: defaultFileSelectorConfig,
        files: [
          new File([Buffer.alloc(25 * 1024 * 1024 + 1)], "too-large.txt", {
            type: "text/plain",
          }),
        ],
        matterId: matter.id,
        userId: user.id,
      }),
    ).rejects.toThrow("Files must be 25 MB or smaller.");

    process.env.MATTER_FILE_MAX_UPLOAD_MB = "1";

    await expect(
      uploadMatterDocuments({
        config: defaultFileSelectorConfig,
        files: [
          new File([Buffer.alloc(1024 * 1024 + 1)], "too-large-override.txt", {
            type: "text/plain",
          }),
        ],
        matterId: matter.id,
        userId: user.id,
      }),
    ).rejects.toThrow("Files must be 1 MB or smaller.");
  } finally {
    restoreEnv({
      maxUploadMb: previousMaxUploadMb,
      storageProvider: previousStorageProvider,
    });

    await cleanupMatters([matter.id]);
  }
});

test("MATTER_FILE_STORAGE_PROVIDER=local uses local storage metadata", async () => {
  const previousStorageProvider = process.env.MATTER_FILE_STORAGE_PROVIDER;
  const previousStorageRoot = process.env.MATTER_FILE_STORAGE_ROOT;
  const previousMaxUploadMb = process.env.MATTER_FILE_MAX_UPLOAD_MB;

  process.env.MATTER_FILE_STORAGE_PROVIDER = "local";
  process.env.MATTER_FILE_STORAGE_ROOT = ".matter-layer/test-uploads";
  delete process.env.MATTER_FILE_MAX_UPLOAD_MB;

  const user = await createUser("local-storage-lawyer@example.com");
  const matter = await prisma.matter.create({
    data: {
      name: `Local Storage Matter ${Date.now()}`,
    },
  });

  try {
    expect(getMatterDocumentStorageProvider().provider).toBe("local");

    const [document] = await uploadMatterDocuments({
      config: defaultFileSelectorConfig,
      files: [
        new File([Buffer.from("local stored file")], "local-file.txt", {
          type: "text/plain",
        }),
      ],
      matterId: matter.id,
      userId: user.id,
    });
    const metadata = await prisma.matterDocument.findUniqueOrThrow({
      where: {
        id: document!.id,
      },
    });

    expect(metadata.storageProvider).toBe("local");
    expect(metadata.storageKey).toContain(matter.id);
    expect(metadata.storageKey).not.toContain(process.cwd());
    await expect(
      prisma.matterDocumentContent.findUnique({
        where: {
          matterDocumentId: document!.id,
        },
      }),
    ).resolves.toBeNull();

    const readFile = await readMatterDocumentFile({
      matterDocumentId: document!.id,
      matterId: matter.id,
    });

    expect(readFile.bytes).toEqual(Buffer.from("local stored file"));
  } finally {
    restoreEnv({
      maxUploadMb: previousMaxUploadMb,
      storageProvider: previousStorageProvider,
      storageRoot: previousStorageRoot,
    });

    await cleanupMatters([matter.id]);
  }
});
