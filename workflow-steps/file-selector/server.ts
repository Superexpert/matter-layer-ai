import "server-only";

import path from "node:path";

import {
  MatterDocumentSourceType,
  WorkflowRunStepFileSelectionSource,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  assertMatterFileWithinUploadLimit,
  getMatterDocumentStorageProvider,
} from "@/services/matter-documents/storage";
import type { FileSelectorStepConfig, FileSelectorStepOutput } from "./schema";
import { validateFileSelectorOutput } from "./schema";

export type FileSelectorMatterDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  sourceType: string;
  storageProvider: string;
  uploadedByUserId: string;
  createdAt: string;
};

export type FileSelectorStepState = {
  documents: FileSelectorMatterDocument[];
  selectedMatterDocumentIds: string[];
};

export type SaveFileSelectionInput = {
  config: FileSelectorStepConfig;
  matterId: string;
  selectedMatterDocumentIds: string[];
  stepId: string;
  uploadedDuringStepMatterDocumentIds: string[];
  workflowDefinitionId: string;
  workflowRunId: string;
  userId: string;
};

function toMatterDocument(document: {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  sourceType: string;
  storageProvider: string;
  uploadedByUserId: string;
  createdAt: Date;
}): FileSelectorMatterDocument {
  return {
    createdAt: document.createdAt.toISOString(),
    fileName: document.fileName,
    id: document.id,
    mimeType: document.mimeType,
    sourceType: document.sourceType,
    storageProvider: document.storageProvider,
    size: document.size,
    uploadedByUserId: document.uploadedByUserId,
  };
}

function assertAcceptedMimeType(file: File, config: FileSelectorStepConfig) {
  if (!config.acceptedMimeTypes?.length) {
    return;
  }

  if (!config.acceptedMimeTypes.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type || "unknown"}.`);
  }
}

function safeFileName(fileName: string) {
  const normalizedFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();

  if (!normalizedFileName) {
    throw new Error("Uploaded file must have a file name.");
  }

  return normalizedFileName;
}

async function assertMatterExists(matterId: string) {
  const matter = await prisma.matter.findUnique({
    select: {
      id: true,
    },
    where: {
      id: matterId,
    },
  });

  if (!matter) {
    throw new Error("Matter was not found.");
  }
}

export async function loadFileSelectorStepState({
  matterId,
  stepId,
  workflowRunId,
}: {
  matterId: string;
  stepId: string;
  workflowRunId: string;
}): Promise<FileSelectorStepState> {
  await assertMatterExists(matterId);

  const [documents, selectedFiles] = await Promise.all([
    prisma.matterDocument.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
        fileName: true,
        id: true,
        mimeType: true,
        sourceType: true,
        storageProvider: true,
        size: true,
        uploadedByUserId: true,
      },
      where: {
        matterId,
      },
    }),
    prisma.workflowRunStepFile.findMany({
      select: {
        matterDocumentId: true,
      },
      where: {
        stepId,
        workflowRun: {
          id: workflowRunId,
          matterId,
        },
      },
    }),
  ]);

  return {
    documents: documents.map(toMatterDocument),
    selectedMatterDocumentIds: selectedFiles.map((file) => file.matterDocumentId),
  };
}

export async function uploadMatterDocuments({
  config,
  files,
  matterId,
  userId,
}: {
  config: FileSelectorStepConfig;
  files: File[];
  matterId: string;
  userId: string;
}) {
  if (!config.allowUpload) {
    throw new Error("Uploads are disabled for this workflow step.");
  }

  if (files.length === 0) {
    throw new Error("Choose at least one file to upload.");
  }

  await assertMatterExists(matterId);

  const documents: FileSelectorMatterDocument[] = [];
  const storageProvider = getMatterDocumentStorageProvider();

  for (const file of files) {
    assertAcceptedMimeType(file, config);
    assertMatterFileWithinUploadLimit(file.size);

    if (file.size <= 0) {
      throw new Error("Uploaded files cannot be empty.");
    }

    const fileName = safeFileName(file.name);
    const documentId = crypto.randomUUID();
    const bytes = Buffer.from(await file.arrayBuffer());

    await prisma.matterDocument.create({
      data: {
        id: documentId,
        fileName,
        matterId,
        mimeType: file.type || "application/octet-stream",
        size: bytes.byteLength,
        sourceType: MatterDocumentSourceType.upload,
        storageKey: null,
        storageProvider: storageProvider.provider,
        uploadedByUserId: userId,
      },
    });

    const storedDocument = await storageProvider.put({
      bytes,
      contentType: file.type || "application/octet-stream",
      documentId,
      fileName,
      matterId,
    });

    const document = await prisma.matterDocument.update({
      data: {
        sha256: storedDocument.sha256,
        size: storedDocument.size,
        storageKey: storedDocument.storageKey,
        storageProvider: storedDocument.storageProvider,
      },
      select: {
        createdAt: true,
        fileName: true,
        id: true,
        mimeType: true,
        sourceType: true,
        storageProvider: true,
        size: true,
        uploadedByUserId: true,
      },
      where: {
        id: documentId,
      },
    });

    documents.push(toMatterDocument(document));
  }

  return documents;
}

export async function saveFileSelectorStepSelection(input: SaveFileSelectionInput) {
  const output: FileSelectorStepOutput = {
    selectedMatterDocumentIds: [...new Set(input.selectedMatterDocumentIds)],
  };
  const validationError = validateFileSelectorOutput(output, input.config);

  if (validationError) {
    throw new Error(validationError);
  }

  if (!input.config.allowExistingMatterFiles && output.selectedMatterDocumentIds.length > 0) {
    const uploadedDuringStepIds = new Set(input.uploadedDuringStepMatterDocumentIds);
    const unsupportedExistingSelection = output.selectedMatterDocumentIds.find(
      (documentId) => !uploadedDuringStepIds.has(documentId),
    );

    if (unsupportedExistingSelection) {
      throw new Error("Existing matter files are disabled for this workflow step.");
    }
  }

  const selectedDocuments = await prisma.matterDocument.findMany({
    select: {
      id: true,
    },
    where: {
      id: {
        in: output.selectedMatterDocumentIds,
      },
      matterId: input.matterId,
    },
  });

  if (selectedDocuments.length !== output.selectedMatterDocumentIds.length) {
    throw new Error("Every selected document must belong to the workflow run matter.");
  }

  const uploadedDuringStepIds = new Set(input.uploadedDuringStepMatterDocumentIds);

  await prisma.$transaction(async (tx) => {
    await tx.workflowRun.upsert({
      create: {
        id: input.workflowRunId,
        matterId: input.matterId,
        workflowDefinitionId: input.workflowDefinitionId,
      },
      update: {
        matterId: input.matterId,
        workflowDefinitionId: input.workflowDefinitionId,
      },
      where: {
        id: input.workflowRunId,
      },
    });

    await tx.workflowRunStepFile.deleteMany({
      where: {
        stepId: input.stepId,
        workflowRunId: input.workflowRunId,
      },
    });

    if (output.selectedMatterDocumentIds.length > 0) {
      await tx.workflowRunStepFile.createMany({
        data: output.selectedMatterDocumentIds.map((matterDocumentId) => ({
          matterDocumentId,
          selectedByUserId: input.userId,
          selectionSource: uploadedDuringStepIds.has(matterDocumentId)
            ? WorkflowRunStepFileSelectionSource.uploaded_during_step
            : WorkflowRunStepFileSelectionSource.manual,
          stepId: input.stepId,
          workflowRunId: input.workflowRunId,
        })) satisfies Prisma.WorkflowRunStepFileCreateManyInput[],
      });
    }

    await tx.workflowRunStepOutput.upsert({
      create: {
        outputJson: JSON.parse(JSON.stringify(output)) as Prisma.InputJsonValue,
        stepId: input.stepId,
        workflowRunId: input.workflowRunId,
      },
      update: {
        outputJson: JSON.parse(JSON.stringify(output)) as Prisma.InputJsonValue,
      },
      where: {
        workflowRunId_stepId: {
          stepId: input.stepId,
          workflowRunId: input.workflowRunId,
        },
      },
    });
  });

  return output;
}
