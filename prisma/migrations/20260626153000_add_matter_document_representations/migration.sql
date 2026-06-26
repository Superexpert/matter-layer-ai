CREATE TYPE "MatterDocumentRepresentationType" AS ENUM ('MARKDOWN');

CREATE TYPE "MatterDocumentRepresentationStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED'
);

CREATE TABLE "MatterDocumentRepresentation" (
  "id" TEXT NOT NULL,
  "matterDocumentId" TEXT NOT NULL,
  "type" "MatterDocumentRepresentationType" NOT NULL,
  "status" "MatterDocumentRepresentationStatus" NOT NULL DEFAULT 'PENDING',
  "content" TEXT,
  "error" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MatterDocumentRepresentation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatterDocumentRepresentation_matterDocumentId_type_key"
  ON "MatterDocumentRepresentation"("matterDocumentId", "type");

CREATE INDEX "MatterDocumentRepresentation_matterDocumentId_idx"
  ON "MatterDocumentRepresentation"("matterDocumentId");

CREATE INDEX "MatterDocumentRepresentation_status_idx"
  ON "MatterDocumentRepresentation"("status");

ALTER TABLE "MatterDocumentRepresentation"
  ADD CONSTRAINT "MatterDocumentRepresentation_matterDocumentId_fkey"
  FOREIGN KEY ("matterDocumentId") REFERENCES "MatterDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
