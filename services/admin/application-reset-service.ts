import "server-only";

import { Prisma, UserRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  createDefaultSampleMatters,
  seedDefaultSampleMatterEvidence,
} from "@/services/matters/sample-matters-service";
import { getMatterDocumentStorageProvider } from "@/services/matter-documents/storage";
import { getCurrentUser } from "@/services/users/user-service";

export const RESET_APPLICATION_CONFIRMATION_PHRASE = "RESET MATTER LAYER";

export class ApplicationResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationResetError";
  }
}

type LocalStoredDocument = {
  id: string;
  storageKey: string;
};

export async function resetMatterLayerApplication(input: {
  confirmationPhrase: string;
}) {
  const currentUser = await getCurrentUser();

  if (currentUser?.role !== UserRole.ADMIN) {
    throw new ApplicationResetError("Admin access is required.");
  }

  if (input.confirmationPhrase !== RESET_APPLICATION_CONFIRMATION_PHRASE) {
    throw new ApplicationResetError("The confirmation phrase is incorrect.");
  }

  const localStoredDocumentRows = await prisma.matterDocument.findMany({
    select: {
      id: true,
      storageKey: true,
    },
    where: {
      storageKey: {
        not: null,
      },
      storageProvider: "local",
    },
  });
  const localStoredDocuments = localStoredDocumentRows.map((document) => {
    if (!document.storageKey) {
      throw new Error("Local matter document is missing its storage key.");
    }

    return {
      id: document.id,
      storageKey: document.storageKey,
    };
  });

  await prisma.$transaction(
    async (tx) => {
      await tx.workflowArtifact.updateMany({
        data: {
          currentRevisionId: null,
        },
      });
      await tx.workflowRunStepActivity.deleteMany();
      await tx.workflowRunStepFile.deleteMany();
      await tx.workflowRunStepOutput.deleteMany();
      await tx.workflowArtifactRevision.deleteMany();
      await tx.workflowArtifact.deleteMany();
      await tx.workflowExtractionRun.deleteMany();
      await tx.workflowRun.deleteMany();
      await tx.matterDocumentRepresentation.deleteMany();
      await tx.matterDocumentContent.deleteMany();
      await tx.matterDocument.deleteMany();
      await tx.matter.deleteMany();
      await createDefaultSampleMatters(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  await deleteLocalStoredDocuments(localStoredDocuments);

  try {
    await seedDefaultSampleMatterEvidence({
      uploadedByUserId: currentUser.id,
    });
  } catch (error) {
    console.error("Sample evidence recreation failed after reset.", {
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw new ApplicationResetError(
      "Application reset completed, but sample evidence recreation failed.",
    );
  }
}

async function deleteLocalStoredDocuments(documents: LocalStoredDocument[]) {
  if (documents.length === 0) {
    return;
  }

  const localStorageProvider = getMatterDocumentStorageProvider("local");

  for (const document of documents) {
    await localStorageProvider.delete({
      matterDocumentId: document.id,
      storageKey: document.storageKey,
    });
  }
}
