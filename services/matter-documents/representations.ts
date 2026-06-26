import "server-only";

import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  Prisma,
  type MatterDocumentRepresentation,
} from "@prisma/client";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import { prisma } from "@/lib/prisma";
import { readMatterDocumentFile } from "./storage";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type EnsureMatterDocumentRepresentationInput = {
  forceRegenerate?: boolean;
  matterDocumentId: string;
  matterId: string;
  type: MatterDocumentRepresentationType;
};

type GetMatterDocumentRepresentationInput = {
  matterDocumentId: string;
  matterId: string;
  type: MatterDocumentRepresentationType;
};

type GeneratedMarkdownRepresentation = {
  content: string;
  metadataJson: Prisma.InputJsonValue;
};

class MatterDocumentRepresentationConversionError extends Error {
  readonly metadataJson?: Prisma.InputJsonValue;

  constructor(message: string, metadataJson?: Prisma.InputJsonValue) {
    super(message);
    this.metadataJson = metadataJson;
  }
}

type MammothWithMarkdown = typeof mammoth & {
  convertToMarkdown: (
    input: { buffer: Buffer },
    options?: Record<string, unknown>,
  ) => Promise<{
    value: string;
    messages: Array<{ message: string; type: string }>;
  }>;
};

function documentMarker({
  documentId,
  fileName,
  type,
}: {
  documentId: string;
  fileName: string;
  type: string;
}) {
  return `<!-- ml:document ${JSON.stringify({ documentId, fileName, type })} -->`;
}

function pageMarker(page: number) {
  return `<!-- ml:page ${JSON.stringify({ page })} -->`;
}

function cleanPdfPageText(text: string) {
  return text.replace(/--\s+\d+\s+of\s+\d+\s+--/g, "").trim();
}

function conciseError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 1000);
  }

  return "Matter Layer could not generate a document representation.";
}

function errorMetadata(error: unknown, fallback: Prisma.InputJsonValue) {
  if (error instanceof MatterDocumentRepresentationConversionError) {
    return error.metadataJson ?? fallback;
  }

  return fallback;
}

function assertMarkdownRepresentationType(type: MatterDocumentRepresentationType) {
  if (type !== MatterDocumentRepresentationType.MARKDOWN) {
    throw new Error(`Unsupported representation type: ${type}`);
  }
}

function metadata(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function convertTextToMarkdown(input: {
  bytes: Buffer;
  documentId: string;
  fileName: string;
  mimeType: string;
}): Promise<GeneratedMarkdownRepresentation> {
  const text = input.bytes.toString("utf8");

  return {
    content: [documentMarker({
      documentId: input.documentId,
      fileName: input.fileName,
      type: input.mimeType,
    }), text].join("\n"),
    metadataJson: metadata({
      converter: "utf8",
      pageBoundaries: false,
      sourceMimeType: input.mimeType,
    }),
  };
}

async function convertDocxToMarkdown(input: {
  bytes: Buffer;
  documentId: string;
  fileName: string;
  mimeType: string;
}): Promise<GeneratedMarkdownRepresentation> {
  const converter = mammoth as MammothWithMarkdown;
  const result = await converter.convertToMarkdown({
    buffer: input.bytes,
  });
  const markdown = result.value.trim();

  if (!markdown) {
    throw new Error("No extractable text was found in the DOCX file.");
  }

  return {
    content: [documentMarker({
      documentId: input.documentId,
      fileName: input.fileName,
      type: input.mimeType,
    }), markdown].join("\n\n"),
    metadataJson: metadata({
      converter: "mammoth",
      converterMessages: result.messages.map((message) => ({
        message: message.message,
        type: message.type,
      })),
      pageBoundaries: false,
      sourceMimeType: input.mimeType,
    }),
  };
}

async function convertPdfToMarkdown(input: {
  bytes: Buffer;
  documentId: string;
  fileName: string;
  mimeType: string;
}): Promise<GeneratedMarkdownRepresentation> {
  const parser = new PDFParse({
    data: input.bytes,
  });

  try {
    const info = await parser.getInfo();
    const pageCount = info.total;
    const pageTexts: string[] = [];

    for (let page = 1; page <= pageCount; page += 1) {
      const pageText = await parser.getText({
        partial: [page],
      });

      pageTexts.push(cleanPdfPageText(pageText.text));
    }

    const hasExtractableText = pageTexts.some((pageText) => pageText.length > 0);

    if (!hasExtractableText) {
      throw new MatterDocumentRepresentationConversionError(
        "No extractable text was found in this PDF. OCR is not implemented yet.",
        metadata({
          converter: "pdf-parse",
          ocrRequired: true,
          pageBoundaries: true,
          pageCount,
          sourceMimeType: input.mimeType,
        }),
      );
    }

    return {
      content: [
        documentMarker({
          documentId: input.documentId,
          fileName: input.fileName,
          type: input.mimeType,
        }),
        ...pageTexts.map((pageText, index) =>
          [pageMarker(index + 1), pageText].join("\n\n"),
        ),
      ].join("\n\n"),
      metadataJson: metadata({
        converter: "pdf-parse",
        ocrRequired: false,
        pageBoundaries: true,
        pageCount,
        sourceMimeType: input.mimeType,
      }),
    };
  } catch (error) {
    throw error;
  } finally {
    await parser.destroy();
  }
}

async function convertMatterDocumentToMarkdown(input: {
  bytes: Buffer;
  documentId: string;
  fileName: string;
  mimeType: string;
}) {
  if (input.mimeType === "text/plain") {
    return convertTextToMarkdown(input);
  }

  if (input.mimeType === DOCX_MIME_TYPE) {
    return convertDocxToMarkdown(input);
  }

  if (input.mimeType === "application/pdf") {
    return convertPdfToMarkdown(input);
  }

  throw new MatterDocumentRepresentationConversionError(
    `Unsupported file type: ${input.mimeType}`,
    metadata({
      sourceMimeType: input.mimeType,
    }),
  );
}

export async function getMatterDocumentRepresentation(
  input: GetMatterDocumentRepresentationInput,
) {
  assertMarkdownRepresentationType(input.type);

  const document = await prisma.matterDocument.findFirst({
    select: {
      id: true,
    },
    where: {
      id: input.matterDocumentId,
      matterId: input.matterId,
    },
  });

  if (!document) {
    throw new Error("Matter document was not found for this matter.");
  }

  return prisma.matterDocumentRepresentation.findUnique({
    where: {
      matterDocumentId_type: {
        matterDocumentId: input.matterDocumentId,
        type: input.type,
      },
    },
  });
}

export async function ensureMatterDocumentRepresentation(
  input: EnsureMatterDocumentRepresentationInput,
): Promise<MatterDocumentRepresentation> {
  assertMarkdownRepresentationType(input.type);

  if (!input.forceRegenerate) {
    const existingRepresentation = await prisma.matterDocumentRepresentation.findFirst({
      where: {
        matterDocumentId: input.matterDocumentId,
        status: MatterDocumentRepresentationStatus.READY,
        type: input.type,
        document: {
          matterId: input.matterId,
        },
      },
    });

    if (existingRepresentation) {
      return existingRepresentation;
    }
  }

  const document = await prisma.matterDocument.findFirst({
    select: {
      fileName: true,
      id: true,
      mimeType: true,
    },
    where: {
      id: input.matterDocumentId,
      matterId: input.matterId,
    },
  });

  if (!document) {
    throw new Error("Matter document was not found for this matter.");
  }

  await prisma.matterDocumentRepresentation.upsert({
    create: {
      matterDocumentId: input.matterDocumentId,
      status: MatterDocumentRepresentationStatus.PROCESSING,
      type: input.type,
    },
    update: {
      content: null,
      error: null,
      metadataJson: Prisma.DbNull,
      status: MatterDocumentRepresentationStatus.PROCESSING,
    },
    where: {
      matterDocumentId_type: {
        matterDocumentId: input.matterDocumentId,
        type: input.type,
      },
    },
  });

  try {
    const file = await readMatterDocumentFile({
      matterDocumentId: document.id,
      matterId: input.matterId,
    });
    const convertedRepresentation = await convertMatterDocumentToMarkdown({
      bytes: file.bytes,
      documentId: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
    });

    return prisma.matterDocumentRepresentation.update({
      data: {
        content: convertedRepresentation.content,
        error: null,
        metadataJson: convertedRepresentation.metadataJson,
        status: MatterDocumentRepresentationStatus.READY,
      },
      where: {
        matterDocumentId_type: {
          matterDocumentId: input.matterDocumentId,
          type: input.type,
        },
      },
    });
  } catch (error) {
    return prisma.matterDocumentRepresentation.update({
      data: {
        content: null,
        error: conciseError(error),
        metadataJson: errorMetadata(error, metadata({
          sourceMimeType: document.mimeType,
        })),
        status: MatterDocumentRepresentationStatus.FAILED,
      },
      where: {
        matterDocumentId_type: {
          matterDocumentId: input.matterDocumentId,
          type: input.type,
        },
      },
    });
  }
}

export async function generateMatterDocumentMarkdown(input: {
  forceRegenerate?: boolean;
  matterDocumentId: string;
  matterId: string;
}) {
  return ensureMatterDocumentRepresentation({
    forceRegenerate: input.forceRegenerate,
    matterDocumentId: input.matterDocumentId,
    matterId: input.matterId,
    type: MatterDocumentRepresentationType.MARKDOWN,
  });
}
