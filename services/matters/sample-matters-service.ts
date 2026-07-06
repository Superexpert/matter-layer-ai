import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  MatterDocumentSourceType,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  assertMatterFileWithinUploadLimit,
  getMatterDocumentStorageProvider,
} from "@/services/matter-documents/storage";

export const DEFAULT_SAMPLE_MATTER_NAMES = [
  "Criminal Matter (Sample)",
  "Eminent Domain Matter (Sample)",
] as const;

export const CRIMINAL_SAMPLE_MATTER_NAME = "Criminal Matter (Sample)";
export const EMINENT_DOMAIN_SAMPLE_MATTER_NAME =
  "Eminent Domain Matter (Sample)";
export const CRIMINAL_SAMPLE_EVIDENCE_DIR = path.join(
  process.cwd(),
  "sample-evidence",
  "criminal",
);
export const EMINENT_DOMAIN_SAMPLE_EVIDENCE_DIR = path.join(
  process.cwd(),
  "sample-evidence",
  "eminent-domain",
);

export type SampleMatterDefinition = {
  evidenceDirectory: string;
  name: (typeof DEFAULT_SAMPLE_MATTER_NAMES)[number];
};

export const SAMPLE_MATTER_DEFINITIONS: readonly SampleMatterDefinition[] = [
  {
    evidenceDirectory: CRIMINAL_SAMPLE_EVIDENCE_DIR,
    name: CRIMINAL_SAMPLE_MATTER_NAME,
  },
  {
    evidenceDirectory: EMINENT_DOMAIN_SAMPLE_EVIDENCE_DIR,
    name: EMINENT_DOMAIN_SAMPLE_MATTER_NAME,
  },
];

type MatterWriter = Pick<PrismaClient, "matter"> | Prisma.TransactionClient;

export async function createDefaultSampleMatters(
  client: MatterWriter = prisma,
) {
  const existingSampleMatters = await client.matter.findMany({
    select: {
      id: true,
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

  for (const name of missingSampleMatterNames) {
    await client.matter.create({
      data: {
        name,
      },
    });
  }
}

export async function seedDefaultSampleMattersIfNoMattersExist(input: {
  uploadedByUserId: string;
}) {
  const createdSamples = await prisma.$transaction(async (tx) => {
    const matterCount = await tx.matter.count();

    if (matterCount > 0) {
      return false;
    }

    await createDefaultSampleMatters(tx);
    return true;
  });

  if (!createdSamples) {
    return;
  }

  await seedDefaultSampleMatterEvidence({
    uploadedByUserId: input.uploadedByUserId,
  });
}

export async function seedDefaultSampleMatterEvidence(input: {
  uploadedByUserId: string;
}) {
  const sampleMatters = await prisma.matter.findMany({
    select: {
      id: true,
      name: true,
    },
    where: {
      name: {
        in: [...DEFAULT_SAMPLE_MATTER_NAMES],
      },
    },
  });
  const mattersByName = new Map(
    sampleMatters.map((matter) => [matter.name, matter]),
  );

  for (const definition of SAMPLE_MATTER_DEFINITIONS) {
    const matter = mattersByName.get(definition.name);

    if (!matter) {
      throw new Error(
        `Sample matter ${definition.name} was not found after seeding.`,
      );
    }

    await seedSampleMatterEvidence({
      definition,
      matterId: matter.id,
      uploadedByUserId: input.uploadedByUserId,
    });
  }
}

export async function seedSampleMatterEvidence(input: {
  definition: SampleMatterDefinition;
  matterId: string;
  uploadedByUserId: string;
}) {
  const evidenceFiles = await listSampleEvidenceFiles(input.definition);

  if (evidenceFiles.length === 0) {
    return;
  }

  const existingDocuments = await prisma.matterDocument.findMany({
    select: {
      fileName: true,
    },
    where: {
      fileName: {
        in: evidenceFiles.map((file) => file.fileName),
      },
      matterId: input.matterId,
    },
  });
  const existingFileNames = new Set(
    existingDocuments.map((document) => document.fileName),
  );
  const storageProvider = getMatterDocumentStorageProvider();

  for (const evidenceFile of evidenceFiles) {
    if (existingFileNames.has(evidenceFile.fileName)) {
      continue;
    }

    const bytes = await readFile(evidenceFile.absolutePath);

    if (bytes.byteLength <= 0) {
      console.warn("Skipping empty sample evidence file.", {
        fileName: evidenceFile.fileName,
        matterName: input.definition.name,
      });
      continue;
    }

    assertMatterFileWithinUploadLimit(bytes.byteLength);

    const documentId = crypto.randomUUID();
    const mimeType = inferMimeType(evidenceFile.fileName);

    await prisma.matterDocument.create({
      data: {
        id: documentId,
        fileName: evidenceFile.fileName,
        matterId: input.matterId,
        mimeType,
        size: bytes.byteLength,
        sourceType: MatterDocumentSourceType.upload,
        storageKey: null,
        storageProvider: storageProvider.provider,
        uploadedByUserId: input.uploadedByUserId,
      },
    });

    const storedDocument = await storageProvider.put({
      bytes,
      contentType: mimeType,
      documentId,
      fileName: evidenceFile.fileName,
      matterId: input.matterId,
    });

    await prisma.matterDocument.update({
      data: {
        sha256: storedDocument.sha256,
        size: storedDocument.size,
        storageKey: storedDocument.storageKey,
        storageProvider: storedDocument.storageProvider,
      },
      where: {
        id: documentId,
      },
    });
  }
}

async function listSampleEvidenceFiles(definition: SampleMatterDefinition) {
  let directoryEntries: string[];

  try {
    directoryEntries = await readdir(definition.evidenceDirectory);
  } catch (error) {
    console.warn("Sample evidence directory is missing or unreadable.", {
      directory: definition.evidenceDirectory,
      errorName: error instanceof Error ? error.name : typeof error,
      matterName: definition.name,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }

  const fileNames = directoryEntries
    .filter((fileName) => !fileName.startsWith("."))
    .sort();

  if (fileNames.length === 0) {
    console.warn("Sample evidence directory is empty.", {
      directory: definition.evidenceDirectory,
      matterName: definition.name,
    });
  }

  return fileNames.map((fileName) => ({
    absolutePath: path.join(definition.evidenceDirectory, fileName),
    fileName,
  }));
}

function inferMimeType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}
