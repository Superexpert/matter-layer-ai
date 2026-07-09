import "server-only";

import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  getMatterDocumentStorageProvider,
  readMatterDocumentFile,
  type MatterFileStorageProviderName,
} from "@/services/matter-documents/storage";
import { markdownToEditorHtml } from "@/workflow-steps/document-editor/conversion";

export type MatterDocumentSection = "workProduct" | "sourceDocument";

export type MatterDocumentSummary = {
  createdAt: string;
  documentSection: MatterDocumentSection;
  fileName: string;
  id: string;
  mimeType: string;
  size: number;
  sourceType: string;
  updatedAt: string;
};

export type EditableMatterDocument = MatterDocumentSummary & {
  contentMarkdown: string;
  editorContentHtml: string;
};

export type CitationSourceDocumentPreview = {
  contentMarkdown: string;
  title: string;
};

export type SaveWorkflowMatterDocumentInput = {
  contentMarkdown: string;
  editorJson?: unknown;
  existingMatterDocumentId?: string | null;
  fileName: string;
  matterId: string;
  stepId: string;
  title: string;
  userId: string;
  workflowDefinitionId: string;
  workflowRunId: string;
};

export type SaveMatterDocumentEditsInput = {
  contentMarkdown: string;
  editorJson?: unknown;
  matterDocumentId: string;
  matterId: string;
};

export type DeleteMatterDocumentInput = {
  matterDocumentId: string;
  matterId: string;
};

const WORKFLOW_OUTPUT_SOURCE_TYPE = "workflow_output";
const UPLOAD_SOURCE_TYPE = "upload";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasWorkflowOutputMetadata(document: {
  representations?: Array<{
    metadataJson: unknown;
  }>;
}) {
  return (document.representations ?? []).some((representation) => {
    const metadata = representation.metadataJson;

    return (
      isObjectRecord(metadata) &&
      (metadata.source === WORKFLOW_OUTPUT_SOURCE_TYPE ||
        typeof metadata.workflowRunId === "string")
    );
  });
}

function getDocumentSection(document: {
  representations?: Array<{
    metadataJson: unknown;
  }>;
  sourceType: string;
}): MatterDocumentSection {
  if (document.sourceType === WORKFLOW_OUTPUT_SOURCE_TYPE) {
    return "workProduct";
  }

  if (document.sourceType === UPLOAD_SOURCE_TYPE) {
    return hasWorkflowOutputMetadata(document) ? "workProduct" : "sourceDocument";
  }

  throw new Error(`Unsupported matter document source type: ${document.sourceType}`);
}

function toSummary(document: {
  createdAt: Date;
  fileName: string;
  id: string;
  mimeType: string;
  representations?: Array<{
    metadataJson: unknown;
  }>;
  size: number;
  sourceType: string;
  updatedAt: Date;
}): MatterDocumentSummary {
  return {
    createdAt: document.createdAt.toISOString(),
    documentSection: getDocumentSection(document),
    fileName: document.fileName,
    id: document.id,
    mimeType: document.mimeType,
    size: document.size,
    sourceType: document.sourceType,
    updatedAt: document.updatedAt.toISOString(),
  };
}

function markdownBytes(contentMarkdown: string) {
  return Buffer.from(contentMarkdown, "utf8");
}

export async function listMatterDocuments(input: {
  matterId: string;
}): Promise<MatterDocumentSummary[]> {
  const documents = await prisma.matterDocument.findMany({
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: {
      createdAt: true,
      fileName: true,
      id: true,
      mimeType: true,
      size: true,
      sourceType: true,
      updatedAt: true,
      representations: {
        select: {
          metadataJson: true,
        },
        where: {
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
    },
    where: {
      matterId: input.matterId,
    },
  });

  return documents.map(toSummary);
}

export async function getEditableMatterDocument(input: {
  matterDocumentId: string;
  matterId: string;
}): Promise<EditableMatterDocument> {
  const document = await prisma.matterDocument.findUnique({
    select: {
      createdAt: true,
      fileName: true,
      id: true,
      mimeType: true,
      size: true,
      sourceType: true,
      updatedAt: true,
      representations: {
        select: {
          content: true,
          metadataJson: true,
        },
        where: {
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
    },
    where: {
      id: input.matterDocumentId,
    },
  });

  if (!document) {
    throw new Error("Matter document was not found.");
  }

  if (document.id !== input.matterDocumentId) {
    throw new Error("Matter document id mismatch.");
  }

  const matterDocument = await prisma.matterDocument.findUnique({
    select: {
      matterId: true,
    },
    where: {
      id: input.matterDocumentId,
    },
  });

  if (!matterDocument || matterDocument.matterId !== input.matterId) {
    throw new Error("Matter document does not belong to the current matter.");
  }

  const summary = toSummary(document);

  if (summary.documentSection !== "workProduct") {
    throw new Error("Source documents are view-only.");
  }

  const markdownRepresentation = document.representations[0];

  if (!markdownRepresentation?.content?.trim()) {
    throw new Error("Editable matter document Markdown content was not found.");
  }

  return {
    ...summary,
    contentMarkdown: markdownRepresentation.content,
    editorContentHtml: markdownToEditorHtml(markdownRepresentation.content),
  };
}

export async function getCitationSourceDocumentPreview(input: {
  matterDocumentId: string;
  matterId: string;
}): Promise<CitationSourceDocumentPreview> {
  const document = await prisma.matterDocument.findFirst({
    select: {
      fileName: true,
      id: true,
      mimeType: true,
      representations: {
        select: {
          content: true,
        },
        where: {
          status: MatterDocumentRepresentationStatus.READY,
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
    },
    where: {
      id: input.matterDocumentId,
      matterId: input.matterId,
    },
  });

  if (!document) {
    throw new Error("The cited source document was not found.");
  }

  const markdownRepresentation = document.representations[0]?.content?.trim();

  if (markdownRepresentation) {
    return {
      contentMarkdown: markdownRepresentation,
      title: document.fileName,
    };
  }

  if (document.mimeType === "text/markdown" || document.mimeType === "text/plain") {
    const file = await readMatterDocumentFile({
      matterDocumentId: document.id,
      matterId: input.matterId,
    });

    return {
      contentMarkdown: file.bytes.toString("utf8"),
      title: file.fileName,
    };
  }

  throw new Error("The cited source document does not have readable Markdown content yet.");
}

export async function saveMatterDocumentEdits(
  input: SaveMatterDocumentEditsInput,
): Promise<EditableMatterDocument> {
  if (!input.contentMarkdown.trim()) {
    throw new Error("Matter document content cannot be empty.");
  }

  const currentDocument = await prisma.matterDocument.findUnique({
    select: {
      createdAt: true,
      fileName: true,
      id: true,
      matterId: true,
      mimeType: true,
      representations: {
        select: {
          metadataJson: true,
        },
        where: {
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
      size: true,
      sourceType: true,
      updatedAt: true,
    },
    where: {
      id: input.matterDocumentId,
    },
  });

  if (!currentDocument) {
    throw new Error("Matter document was not found.");
  }

  if (currentDocument.matterId !== input.matterId) {
    throw new Error("Matter document does not belong to the current matter.");
  }

  if (getDocumentSection(currentDocument) !== "workProduct") {
    throw new Error("Source documents are view-only.");
  }

  const bytes = markdownBytes(input.contentMarkdown);
  const storageProvider = getMatterDocumentStorageProvider();
  const storedDocument = await storageProvider.put({
    bytes,
    contentType: "text/markdown",
    documentId: input.matterDocumentId,
    fileName: currentDocument.fileName,
    matterId: input.matterId,
  });
  const existingMetadata = currentDocument.representations[0]?.metadataJson;
  const metadataJson = {
    ...(isObjectRecord(existingMetadata) ? existingMetadata : {}),
    editorJson: input.editorJson ?? null,
    source: WORKFLOW_OUTPUT_SOURCE_TYPE,
  };

  await prisma.matterDocument.update({
    data: {
      mimeType: "text/markdown",
      sha256: storedDocument.sha256,
      size: storedDocument.size,
      storageKey: storedDocument.storageKey,
      storageProvider: storedDocument.storageProvider,
      representations: {
        update: {
          data: {
            content: input.contentMarkdown,
            error: null,
            metadataJson,
            status: MatterDocumentRepresentationStatus.READY,
          },
          where: {
            matterDocumentId_type: {
              matterDocumentId: input.matterDocumentId,
              type: MatterDocumentRepresentationType.MARKDOWN,
            },
          },
        },
      },
    },
    where: {
      id: input.matterDocumentId,
    },
  });

  return getEditableMatterDocument(input);
}

export async function deleteMatterDocument(input: DeleteMatterDocumentInput) {
  const document = await prisma.matterDocument.findUnique({
    select: {
      id: true,
      matterId: true,
      storageKey: true,
      storageProvider: true,
    },
    where: {
      id: input.matterDocumentId,
    },
  });

  if (!document) {
    throw new Error("Matter document was not found.");
  }

  if (document.matterId !== input.matterId) {
    throw new Error("Matter document does not belong to the current matter.");
  }

  const matter = await prisma.matter.findUnique({
    select: {
      id: true,
    },
    where: {
      id: input.matterId,
    },
  });

  if (!matter) {
    throw new Error("Matter was not found.");
  }

  const storageProvider = getMatterDocumentStorageProvider(
    document.storageProvider as MatterFileStorageProviderName,
  );

  await storageProvider.delete({
    matterDocumentId: document.id,
    storageKey: document.storageKey,
  });

  await prisma.matterDocument.delete({
    where: {
      id: document.id,
    },
  });
}

export async function saveWorkflowMatterDocument(
  input: SaveWorkflowMatterDocumentInput,
): Promise<MatterDocumentSummary> {
  if (!input.contentMarkdown.trim()) {
    throw new Error("Matter document content cannot be empty.");
  }

  const matter = await prisma.matter.findUnique({
    select: {
      id: true,
    },
    where: {
      id: input.matterId,
    },
  });

  if (!matter) {
    throw new Error("Matter was not found.");
  }

  const bytes = markdownBytes(input.contentMarkdown);
  const storageProvider = getMatterDocumentStorageProvider();
  let documentId = input.existingMatterDocumentId?.trim() || null;

  if (documentId) {
    const existingDocument = await prisma.matterDocument.findUnique({
      select: {
        id: true,
        matterId: true,
      },
      where: {
        id: documentId,
      },
    });

    if (!existingDocument) {
      throw new Error("Saved matter document was not found.");
    }

    if (existingDocument.matterId !== input.matterId) {
      throw new Error("Saved matter document does not belong to the current matter.");
    }
  } else {
    documentId = crypto.randomUUID();
    await prisma.matterDocument.create({
      data: {
        fileName: input.fileName,
        id: documentId,
        matterId: input.matterId,
        mimeType: "text/markdown",
        size: bytes.byteLength,
        sourceType: UPLOAD_SOURCE_TYPE,
        storageKey: null,
        storageProvider: storageProvider.provider,
        uploadedByUserId: input.userId,
      },
    });
  }

  const storedDocument = await storageProvider.put({
    bytes,
    contentType: "text/markdown",
    documentId,
    fileName: input.fileName,
    matterId: input.matterId,
  });

  const document = await prisma.matterDocument.update({
    data: {
      fileName: input.fileName,
      mimeType: "text/markdown",
      sha256: storedDocument.sha256,
      size: storedDocument.size,
      sourceType: UPLOAD_SOURCE_TYPE,
      storageKey: storedDocument.storageKey,
      storageProvider: storedDocument.storageProvider,
      representations: {
        upsert: {
          create: {
            content: input.contentMarkdown,
            metadataJson: {
              editorJson: input.editorJson ?? null,
              source: "workflow_output",
              stepId: input.stepId,
              title: input.title,
              workflowDefinitionId: input.workflowDefinitionId,
              workflowRunId: input.workflowRunId,
            },
            status: MatterDocumentRepresentationStatus.READY,
            type: MatterDocumentRepresentationType.MARKDOWN,
          },
          update: {
            content: input.contentMarkdown,
            error: null,
            metadataJson: {
              editorJson: input.editorJson ?? null,
              source: "workflow_output",
              stepId: input.stepId,
              title: input.title,
              workflowDefinitionId: input.workflowDefinitionId,
              workflowRunId: input.workflowRunId,
            },
            status: MatterDocumentRepresentationStatus.READY,
          },
          where: {
            matterDocumentId_type: {
              matterDocumentId: documentId,
              type: MatterDocumentRepresentationType.MARKDOWN,
            },
          },
        },
      },
    },
    select: {
      createdAt: true,
      fileName: true,
      id: true,
      mimeType: true,
      size: true,
      sourceType: true,
      updatedAt: true,
      representations: {
        select: {
          metadataJson: true,
        },
        where: {
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
    },
    where: {
      id: documentId,
    },
  });

  return toSummary(document);
}
