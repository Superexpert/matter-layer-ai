ALTER TABLE "MatterDocument"
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'database',
  ALTER COLUMN "storageKey" DROP NOT NULL;

UPDATE "MatterDocument"
SET "storageProvider" = 'local'
WHERE "storageKey" IS NOT NULL;

CREATE TABLE "MatterDocumentContent" (
  "id" TEXT NOT NULL,
  "matterDocumentId" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MatterDocumentContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatterDocumentContent_matterDocumentId_key"
  ON "MatterDocumentContent"("matterDocumentId");

CREATE INDEX "MatterDocument_storageProvider_idx"
  ON "MatterDocument"("storageProvider");

ALTER TABLE "MatterDocumentContent"
  ADD CONSTRAINT "MatterDocumentContent_matterDocumentId_fkey"
  FOREIGN KEY ("matterDocumentId") REFERENCES "MatterDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
