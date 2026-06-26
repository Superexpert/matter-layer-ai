import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

export type MatterFileStorageProviderName = "database" | "local";

export type StoredMatterDocument = {
  sha256?: string;
  size: number;
  storageKey: string | null;
  storageProvider: MatterFileStorageProviderName;
};

export type ReadMatterDocumentContent = {
  bytes: Buffer;
  contentType?: string | null;
  size?: number | null;
};

export interface MatterDocumentStorageProvider {
  readonly provider: MatterFileStorageProviderName;

  put(input: {
    matterId: string;
    documentId: string;
    fileName: string;
    contentType?: string;
    bytes: Uint8Array | Buffer;
  }): Promise<StoredMatterDocument>;

  get(input: {
    matterDocumentId: string;
    storageKey?: string | null;
  }): Promise<ReadMatterDocumentContent>;

  delete(input: {
    matterDocumentId: string;
    storageKey?: string | null;
  }): Promise<void>;
}

const DEFAULT_MAX_UPLOAD_MB = 25;
const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_LOCAL_STORAGE_ROOT = ".matter-layer/uploads";

function sha256Hex(bytes: Uint8Array | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function getMatterFileStorageProviderName(): MatterFileStorageProviderName {
  const rawProvider = process.env.MATTER_FILE_STORAGE_PROVIDER?.trim() || "database";

  if (rawProvider === "database" || rawProvider === "local") {
    return rawProvider;
  }

  throw new Error(`Unsupported MATTER_FILE_STORAGE_PROVIDER: ${rawProvider}.`);
}

export function getMatterFileMaxUploadBytes() {
  const rawMaxUploadMb = process.env.MATTER_FILE_MAX_UPLOAD_MB?.trim();

  if (!rawMaxUploadMb) {
    return DEFAULT_MAX_UPLOAD_MB * BYTES_PER_MB;
  }

  const maxUploadMb = Number(rawMaxUploadMb);

  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0) {
    throw new Error("MATTER_FILE_MAX_UPLOAD_MB must be a positive number.");
  }

  return Math.floor(maxUploadMb * BYTES_PER_MB);
}

export function getMatterFileMaxUploadLabel() {
  const maxUploadMb = getMatterFileMaxUploadBytes() / BYTES_PER_MB;

  return Number.isInteger(maxUploadMb)
    ? `${maxUploadMb} MB`
    : `${maxUploadMb.toFixed(1)} MB`;
}

export function assertMatterFileWithinUploadLimit(size: number) {
  const maxUploadBytes = getMatterFileMaxUploadBytes();

  if (size > maxUploadBytes) {
    throw new Error(`Files must be ${getMatterFileMaxUploadLabel()} or smaller.`);
  }
}

function localStorageRoot() {
  const configuredRoot =
    process.env.MATTER_FILE_STORAGE_ROOT?.trim() || DEFAULT_LOCAL_STORAGE_ROOT;

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.join(/*turbopackIgnore: true*/ process.cwd(), configuredRoot);
}

function localStoragePath(storageKey: string) {
  if (path.isAbsolute(storageKey)) {
    throw new Error("Local matter document storage key must be relative.");
  }

  const root = localStorageRoot();
  const absolutePath = path.resolve(root, storageKey);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Local matter document storage key is outside the storage root.");
  }

  return absolutePath;
}

function safeFileName(fileName: string) {
  const normalizedFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();

  if (!normalizedFileName) {
    throw new Error("Uploaded file must have a file name.");
  }

  return normalizedFileName;
}

export class DatabaseMatterDocumentStorageProvider
  implements MatterDocumentStorageProvider
{
  readonly provider: MatterFileStorageProviderName = "database";

  async put(input: {
    matterId: string;
    documentId: string;
    fileName: string;
    contentType?: string;
    bytes: Uint8Array | Buffer;
  }) {
    const bytes = Buffer.from(input.bytes);

    await prisma.matterDocumentContent.upsert({
      create: {
        bytes,
        matterDocumentId: input.documentId,
      },
      update: {
        bytes,
      },
      where: {
        matterDocumentId: input.documentId,
      },
    });

    return {
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      storageKey: null,
      storageProvider: this.provider,
    };
  }

  async get(input: { matterDocumentId: string }) {
    const content = await prisma.matterDocumentContent.findUnique({
      select: {
        bytes: true,
      },
      where: {
        matterDocumentId: input.matterDocumentId,
      },
    });

    if (!content) {
      throw new Error("Matter document content was not found.");
    }

    return {
      bytes: Buffer.from(content.bytes),
      size: content.bytes.byteLength,
    };
  }

  async delete(input: { matterDocumentId: string }) {
    await prisma.matterDocumentContent.deleteMany({
      where: {
        matterDocumentId: input.matterDocumentId,
      },
    });
  }
}

export class LocalMatterDocumentStorageProvider implements MatterDocumentStorageProvider {
  readonly provider: MatterFileStorageProviderName = "local";

  async put(input: {
    matterId: string;
    documentId: string;
    fileName: string;
    contentType?: string;
    bytes: Uint8Array | Buffer;
  }) {
    const bytes = Buffer.from(input.bytes);
    const storageKey = path.join(
      input.matterId,
      `${input.documentId}-${safeFileName(input.fileName)}`,
    );
    const absolutePath = localStoragePath(storageKey);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);

    return {
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      storageKey,
      storageProvider: this.provider,
    };
  }

  async get(input: { matterDocumentId: string; storageKey?: string | null }) {
    if (!input.storageKey) {
      throw new Error("Local matter document storage key is required.");
    }

    const bytes = await readFile(localStoragePath(input.storageKey));

    return {
      bytes,
      size: bytes.byteLength,
    };
  }

  async delete(input: { matterDocumentId: string; storageKey?: string | null }) {
    if (!input.storageKey) {
      return;
    }

    await rm(localStoragePath(input.storageKey), {
      force: true,
    });
  }
}

export function getMatterDocumentStorageProvider(
  providerName: MatterFileStorageProviderName = getMatterFileStorageProviderName(),
) {
  if (providerName === "database") {
    return new DatabaseMatterDocumentStorageProvider();
  }

  if (providerName === "local") {
    return new LocalMatterDocumentStorageProvider();
  }

  throw new Error(`Unsupported matter document storage provider: ${providerName}`);
}

export async function readMatterDocumentFile({
  matterDocumentId,
  matterId,
}: {
  matterDocumentId: string;
  matterId: string;
}) {
  const document = await prisma.matterDocument.findFirst({
    select: {
      fileName: true,
      id: true,
      mimeType: true,
      size: true,
      storageKey: true,
      storageProvider: true,
    },
    where: {
      id: matterDocumentId,
      matterId,
    },
  });

  if (!document) {
    throw new Error("Matter document was not found for this matter.");
  }

  const provider = getMatterDocumentStorageProvider(
    document.storageProvider as MatterFileStorageProviderName,
  );
  const content = await provider.get({
    matterDocumentId: document.id,
    storageKey: document.storageKey,
  });

  return {
    bytes: content.bytes,
    contentType: document.mimeType,
    fileName: document.fileName,
    size: document.size,
  };
}
