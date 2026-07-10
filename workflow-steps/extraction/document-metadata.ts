export type ExtractionDocumentDateSource =
  | "document-content"
  | "email-metadata"
  | "filename"
  | "other"
  | "stored-metadata";

export type ExtractionDocumentDateConfidence = "high" | "low" | "medium";

export type ExtractionDocumentSourceType = "docx" | "email" | "other" | "pdf" | "txt";

export type ExtractionDocumentMetadata = {
  documentDate?: string;
  documentDateConfidence?: ExtractionDocumentDateConfidence;
  documentDateSource?: ExtractionDocumentDateSource;
  documentId: string;
  documentName: string;
  mimeType?: string;
  originalFileName?: string;
  sourceType?: ExtractionDocumentSourceType;
};

type MetadataRecord = Record<string, unknown>;

function isObjectRecord(value: unknown): value is MetadataRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function isoDateFromMetadataValue(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (isValidIsoDate(trimmed)) {
    return trimmed;
  }

  const dateTimePrefix = /^(\d{4}-\d{2}-\d{2})T/.exec(trimmed);

  if (dateTimePrefix && isValidIsoDate(dateTimePrefix[1]!)) {
    return dateTimePrefix[1];
  }

  return undefined;
}

function sourceTypeFromMimeType(mimeType: string | undefined): ExtractionDocumentSourceType {
  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return "txt";
  }

  if (mimeType === "message/rfc822") {
    return "email";
  }

  return "other";
}

export function parseIsoDatePrefixFromFileName(
  fileName: string,
): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(fileName.trim());

  if (!match) {
    return undefined;
  }

  const candidateDate = match[1]!;
  const remainder = match[2]!.trim();

  if (!remainder || !isValidIsoDate(candidateDate)) {
    return undefined;
  }

  return candidateDate;
}

function dateFromMetadata(
  metadata: unknown,
  keys: string[],
): string | undefined {
  if (!isObjectRecord(metadata)) {
    return undefined;
  }

  for (const key of keys) {
    const date = isoDateFromMetadataValue(metadata[key]);

    if (date) {
      return date;
    }
  }

  return undefined;
}

export function resolveExtractionDocumentMetadata(input: {
  documentId: string;
  documentName: string;
  emailMetadata?: unknown;
  mimeType?: string;
  originalFileName?: string;
  representationMetadata?: unknown;
  storedMetadata?: unknown;
}): ExtractionDocumentMetadata {
  const baseMetadata: ExtractionDocumentMetadata = {
    documentId: input.documentId,
    documentName: input.documentName,
    mimeType: input.mimeType,
    originalFileName: input.originalFileName,
    sourceType: sourceTypeFromMimeType(input.mimeType),
  };
  const storedDate = dateFromMetadata(input.storedMetadata, [
    "documentDate",
    "normalizedDocumentDate",
  ]);

  if (storedDate) {
    return {
      ...baseMetadata,
      documentDate: storedDate,
      documentDateConfidence: "high",
      documentDateSource: "stored-metadata",
    };
  }

  const emailDate = dateFromMetadata(input.emailMetadata, [
    "sentAt",
    "receivedAt",
    "emailSentAt",
    "emailReceivedAt",
    "documentDate",
  ]);

  if (emailDate) {
    return {
      ...baseMetadata,
      documentDate: emailDate,
      documentDateConfidence: "high",
      documentDateSource: "email-metadata",
      sourceType: "email",
    };
  }

  const filenameDate = parseIsoDatePrefixFromFileName(input.documentName);

  if (filenameDate) {
    return {
      ...baseMetadata,
      documentDate: filenameDate,
      documentDateConfidence: "high",
      documentDateSource: "filename",
    };
  }

  const representationDate = dateFromMetadata(input.representationMetadata, [
    "documentDate",
    "normalizedDocumentDate",
  ]);

  if (representationDate) {
    return {
      ...baseMetadata,
      documentDate: representationDate,
      documentDateConfidence: "high",
      documentDateSource: "document-content",
    };
  }

  return baseMetadata;
}

export function documentMetadataPromptBlock(
  metadata: ExtractionDocumentMetadata | undefined,
) {
  if (!metadata) {
    return null;
  }

  return [
    "Document metadata:",
    `- File name: ${metadata.documentName}`,
    metadata.mimeType ? `- MIME type: ${metadata.mimeType}` : null,
    metadata.sourceType ? `- Source type: ${metadata.sourceType}` : null,
    metadata.documentDate ? `- Document date: ${metadata.documentDate}` : null,
    metadata.documentDateSource
      ? `- Document date source: ${metadata.documentDateSource}`
      : null,
    metadata.documentDateConfidence
      ? `- Document date confidence: ${metadata.documentDateConfidence}`
      : null,
    "Metadata usage rules:",
    "- Use the document date only when the fact describes an event, communication, filing, notice, offer, appraisal, or other occurrence represented by the document itself.",
    "- Do not use the document date for historical events merely mentioned inside the document.",
    "- Prefer a date explicitly stated in the document text when it clearly applies to the fact.",
    "- Do not quote metadata as though it appeared in the document body.",
  ].filter(Boolean).join("\n");
}
