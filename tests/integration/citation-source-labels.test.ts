import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, expect, test } from "vitest";

import { getEditableWorkflowArtifact } from "../../services/workflows/workflow-run-service";
import { getCitationSourceDocumentPreview } from "../../services/matter-documents/matter-document-service";

const prisma = new PrismaClient();

afterAll(async () => prisma.$disconnect());
beforeEach(async () => {
  await prisma.workflowArtifact.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.matterDocument.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.user.deleteMany();
});

test("existing citation labels resolve from document ID within the artifact matter", async () => {
  const user = await prisma.user.create({ data: { email: `citation-${Date.now()}@example.com`, name: "Citation Tester" } });
  const [matter, otherMatter] = await Promise.all([
    prisma.matter.create({ data: { name: "Citation Matter" } }),
    prisma.matter.create({ data: { name: "Other Matter" } }),
  ]);
  const source = await prisma.matterDocument.create({ data: { fileName: "2026-03-18 Petition in Condemnation.pdf", matterId: matter.id, mimeType: "application/pdf", size: 100, uploadedByUserId: user.id } });
  const foreignSource = await prisma.matterDocument.create({ data: { fileName: "Other Matter Secret.pdf", matterId: otherMatter.id, mimeType: "application/pdf", size: 100, uploadedByUserId: user.id } });
  const run = await prisma.workflowRun.create({ data: { id: `citation-run-${Date.now()}`, matterId: matter.id, workflowDefinitionId: "eminent-domain-case-assessment" } });
  const artifact = await prisma.workflowArtifact.create({ data: {
    content: [
      `Owner supported by <span data-ml-citation="true" data-citation-label="Document p. 2" data-citation-printable-text="(Document, p. 2)" data-citation-source-document-id="${source.id}" data-citation-page="2" data-citation-cited-text="Ramirez Family Holdings, LLC">Document p. 2</span>.`,
      `Foreign <span data-ml-citation="true" data-citation-label="Document p. 1" data-citation-source-document-id="${foreignSource.id}" data-citation-source-document-name="Other Matter Secret.pdf" data-citation-page="1">Document p. 1</span>.`,
    ].join("\n\n"),
    matterId: matter.id, stepId: "analyze-case", title: "Lawyer Memo", type: "MARKDOWN", workflowRunId: run.id,
  } });

  const editable = await getEditableWorkflowArtifact({ artifactId: artifact.id, matterId: matter.id, workflowRunId: run.id });
  expect(editable.contentMarkdown).toContain("Petition in Condemnation p. 2");
  expect(editable.editorContentHtml).toContain('data-citation-source-document-name="2026-03-18 Petition in Condemnation.pdf"');
  expect(editable.contentMarkdown).toContain("Source p. 1");
  expect(editable.contentMarkdown).not.toContain("Other Matter Secret");

  const preview = await getCitationSourceDocumentPreview({ matterDocumentId: source.id, matterId: matter.id });
  expect(preview.sourceFileName).toBe("2026-03-18 Petition in Condemnation.pdf");
  expect(preview.originalUrl).toContain(source.id);
  await expect(getCitationSourceDocumentPreview({ matterDocumentId: foreignSource.id, matterId: matter.id })).rejects.toThrow("not found");
});
