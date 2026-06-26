import { expect, test } from "@playwright/test";
import {
  MatterDocumentSourceType,
  PrismaClient,
  WorkflowRunStepFileSelectionSource,
} from "@prisma/client";

import {
  addTestAuthSession,
  seedTestAISettings,
  startNextTestServer,
} from "./next-test-server";
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

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("File Selector renders, validates, uploads, auto-selects, and persists selections", async ({
  page,
}) => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const server = await startNextTestServer({ port: 3221 });
  const user = await prisma.user.upsert({
    create: {
      email: "lawyer@smithlaw.com",
      name: "Test Lawyer",
    },
    update: {},
    where: {
      email: "lawyer@smithlaw.com",
    },
  });
  const matter = await prisma.matter.create({
    data: {
      name: `File Selector Matter ${Date.now()}`,
    },
  });
  const existingDocument = await prisma.matterDocument.create({
    data: {
      fileName: "existing-source.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      size: 18,
      sourceType: MatterDocumentSourceType.upload,
      storageProvider: "local",
      storageKey: `${matter.id}/existing-source.txt`,
      uploadedByUserId: user.id,
    },
  });

  try {
    await seedTestAISettings();
    await addTestAuthSession(page, server.baseURL);
    await page.goto(`${server.baseURL}/app/matters/${matter.id}`);

    await expect(page.getByTestId("available-workflows-panel")).toContainText(
      "Chronology",
    );
    await page.getByTestId("workflow-chip-chronology").click();

    await expect(page.getByTestId("file-selector-step")).toBeVisible();
    await expect(page.getByTestId("file-selector-step")).toContainText(
      "Select source documents",
    );
    await expect(page.getByTestId("file-selector-document-list")).toContainText(
      "existing-source.txt",
    );
    await expect(page.getByTestId("file-selector-continue")).toBeDisabled();
    await expect(page.getByTestId("file-selector-validation")).toContainText(
      "Select at least 1 file.",
    );

    await page
      .getByTestId(`file-selector-checkbox-${existingDocument.id}`)
      .check();
    await expect(page.getByTestId("file-selector-summary")).toContainText(
      "1 document selected.",
    );

    await page
      .getByTestId("file-selector-upload-input")
      .setInputFiles({
        buffer: Buffer.from("uploaded chronology source"),
        mimeType: "text/plain",
        name: "uploaded-source.txt",
      });
    await expect(page.getByTestId("file-selector-document-list")).toContainText(
      "uploaded-source.txt",
    );
    await expect(page.getByTestId("file-selector-summary")).toContainText(
      "2 documents selected.",
    );

    await page
      .getByTestId("file-selector-upload-input")
      .setInputFiles({
        buffer: Buffer.from("<html></html>"),
        mimeType: "text/html",
        name: "unsupported.html",
      });
    await expect(page.getByTestId("file-selector-validation")).toContainText(
      "Unsupported file type: text/html.",
    );

    await page.getByTestId("file-selector-continue").click();
    await expect(page.getByTestId("workflow-active-summary")).toContainText(
      "Current step: Extract chronology events",
    );

    const persistedSelections = await prisma.workflowRunStepFile.findMany({
      include: {
        matterDocument: true,
      },
      orderBy: {
        matterDocument: {
          fileName: "asc",
        },
      },
      where: {
        stepId: "select-source-files",
        workflowRun: {
          matterId: matter.id,
          workflowDefinitionId: "chronology",
        },
      },
    });

    expect(persistedSelections).toHaveLength(2);
    expect(persistedSelections.map((selection) => selection.matterDocument.fileName)).toEqual([
      "existing-source.txt",
      "uploaded-source.txt",
    ]);
    const uploadedDocument = persistedSelections.find(
      (selection) => selection.matterDocument.fileName === "uploaded-source.txt",
    )?.matterDocument;

    expect(uploadedDocument?.storageProvider).toBe("database");
    expect(uploadedDocument?.storageKey).toBeNull();
    await expect(
      prisma.matterDocumentContent.findUnique({
        where: {
          matterDocumentId: uploadedDocument!.id,
        },
      }),
    ).resolves.toMatchObject({
      bytes: Buffer.from("uploaded chronology source"),
    });
    expect(
      persistedSelections.find(
        (selection) => selection.matterDocument.fileName === "existing-source.txt",
      )?.selectionSource,
    ).toBe(WorkflowRunStepFileSelectionSource.manual);
    expect(
      persistedSelections.find(
        (selection) => selection.matterDocument.fileName === "uploaded-source.txt",
      )?.selectionSource,
    ).toBe(WorkflowRunStepFileSelectionSource.uploaded_during_step);
  } finally {
    await prisma.workflowRunStepFile.deleteMany({
      where: {
        workflowRun: {
          matterId: matter.id,
        },
      },
    });
    await prisma.workflowRun.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matterDocument.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matter.delete({
      where: {
        id: matter.id,
      },
    });
    await server.stop();
  }
});

test("File Selector rejects selections containing documents from another matter", async () => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const user = await prisma.user.upsert({
    create: {
      email: "cross-matter-lawyer@example.com",
      name: "Cross Matter Lawyer",
    },
    update: {},
    where: {
      email: "cross-matter-lawyer@example.com",
    },
  });
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
      storageProvider: "local",
      storageKey: `${otherMatter.id}/other-matter.txt`,
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
    await prisma.workflowRunStepFile.deleteMany({
      where: {
        workflowRun: {
          matterId: {
            in: [matter.id, otherMatter.id],
          },
        },
      },
    });
    await prisma.workflowRun.deleteMany({
      where: {
        matterId: {
          in: [matter.id, otherMatter.id],
        },
      },
    });
    await prisma.matterDocument.deleteMany({
      where: {
        matterId: {
          in: [matter.id, otherMatter.id],
        },
      },
    });
    await prisma.matter.deleteMany({
      where: {
        id: {
          in: [matter.id, otherMatter.id],
        },
      },
    });
  }
});

test("matter document storage defaults to database and keeps list queries metadata-only", async () => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const previousStorageProvider = process.env.MATTER_FILE_STORAGE_PROVIDER;
  const previousMaxUploadMb = process.env.MATTER_FILE_MAX_UPLOAD_MB;

  delete process.env.MATTER_FILE_STORAGE_PROVIDER;
  delete process.env.MATTER_FILE_MAX_UPLOAD_MB;

  const user = await prisma.user.upsert({
    create: {
      email: "db-storage-lawyer@example.com",
      name: "DB Storage Lawyer",
    },
    update: {},
    where: {
      email: "db-storage-lawyer@example.com",
    },
  });
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

    expect(content.bytes).toEqual(Buffer.from("database stored file"));

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

    await expect(
      readMatterDocumentFile({
        matterDocumentId: document!.id,
        matterId: otherMatter.id,
      }),
    ).rejects.toThrow("Matter document was not found for this matter.");

    await prisma.matter.delete({
      where: {
        id: otherMatter.id,
      },
    });
  } finally {
    if (previousStorageProvider === undefined) {
      delete process.env.MATTER_FILE_STORAGE_PROVIDER;
    } else {
      process.env.MATTER_FILE_STORAGE_PROVIDER = previousStorageProvider;
    }

    if (previousMaxUploadMb === undefined) {
      delete process.env.MATTER_FILE_MAX_UPLOAD_MB;
    } else {
      process.env.MATTER_FILE_MAX_UPLOAD_MB = previousMaxUploadMb;
    }

    await prisma.workflowRunStepFile.deleteMany({
      where: {
        workflowRun: {
          matterId: matter.id,
        },
      },
    });
    await prisma.workflowRun.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matterDocument.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matter.delete({
      where: {
        id: matter.id,
      },
    });
  }
});

test("matter document upload limit defaults to 25 MB and can be overridden", async () => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const previousStorageProvider = process.env.MATTER_FILE_STORAGE_PROVIDER;
  const previousMaxUploadMb = process.env.MATTER_FILE_MAX_UPLOAD_MB;

  delete process.env.MATTER_FILE_STORAGE_PROVIDER;
  delete process.env.MATTER_FILE_MAX_UPLOAD_MB;

  const user = await prisma.user.upsert({
    create: {
      email: "limit-lawyer@example.com",
      name: "Limit Lawyer",
    },
    update: {},
    where: {
      email: "limit-lawyer@example.com",
    },
  });
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
    if (previousStorageProvider === undefined) {
      delete process.env.MATTER_FILE_STORAGE_PROVIDER;
    } else {
      process.env.MATTER_FILE_STORAGE_PROVIDER = previousStorageProvider;
    }

    if (previousMaxUploadMb === undefined) {
      delete process.env.MATTER_FILE_MAX_UPLOAD_MB;
    } else {
      process.env.MATTER_FILE_MAX_UPLOAD_MB = previousMaxUploadMb;
    }

    await prisma.matterDocument.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matter.delete({
      where: {
        id: matter.id,
      },
    });
  }
});

test("MATTER_FILE_STORAGE_PROVIDER=local uses local storage metadata", async () => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires DATABASE_URL and a migrated PostgreSQL database.",
  );

  const previousStorageProvider = process.env.MATTER_FILE_STORAGE_PROVIDER;
  const previousStorageRoot = process.env.MATTER_FILE_STORAGE_ROOT;
  const previousMaxUploadMb = process.env.MATTER_FILE_MAX_UPLOAD_MB;

  process.env.MATTER_FILE_STORAGE_PROVIDER = "local";
  process.env.MATTER_FILE_STORAGE_ROOT = ".matter-layer/test-uploads";
  delete process.env.MATTER_FILE_MAX_UPLOAD_MB;

  const user = await prisma.user.upsert({
    create: {
      email: "local-storage-lawyer@example.com",
      name: "Local Storage Lawyer",
    },
    update: {},
    where: {
      email: "local-storage-lawyer@example.com",
    },
  });
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
    if (previousStorageProvider === undefined) {
      delete process.env.MATTER_FILE_STORAGE_PROVIDER;
    } else {
      process.env.MATTER_FILE_STORAGE_PROVIDER = previousStorageProvider;
    }

    if (previousStorageRoot === undefined) {
      delete process.env.MATTER_FILE_STORAGE_ROOT;
    } else {
      process.env.MATTER_FILE_STORAGE_ROOT = previousStorageRoot;
    }

    if (previousMaxUploadMb === undefined) {
      delete process.env.MATTER_FILE_MAX_UPLOAD_MB;
    } else {
      process.env.MATTER_FILE_MAX_UPLOAD_MB = previousMaxUploadMb;
    }

    await prisma.matterDocument.deleteMany({
      where: {
        matterId: matter.id,
      },
    });
    await prisma.matter.delete({
      where: {
        id: matter.id,
      },
    });
  }
});
