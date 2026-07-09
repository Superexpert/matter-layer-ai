import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  PrismaClient,
} from "@prisma/client";
import JSZip from "jszip";
import { afterAll, expect, test } from "vitest";

import { uploadMatterDocuments } from "../../workflow-steps/file-selector/server";
import { defaultFileSelectorConfig } from "../../workflow-steps/file-selector/schema";
import {
  deleteMatterDocument,
  getCitationSourceDocumentPreview,
} from "../../services/matter-documents/matter-document-service";
import {
  ensureMatterDocumentRepresentation,
  generateMatterDocumentMarkdown,
  getMatterDocumentRepresentation,
} from "../../services/matter-documents/representations";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUserAndMatter() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `representation-${suffix}@example.com`,
      name: "Representation Lawyer",
    },
  });
  const matter = await prisma.matter.create({
    data: {
      name: `Representation Matter ${suffix}`,
    },
  });

  return {
    matter,
    user,
  };
}

async function uploadFixture(input: {
  bytes: Buffer;
  fileName: string;
  matterId: string;
  mimeType: string;
  userId: string;
}) {
  const [document] = await uploadMatterDocuments({
    config: {
      ...defaultFileSelectorConfig,
      acceptedMimeTypes: null,
    },
    files: [
      new File([new Uint8Array(input.bytes)], input.fileName, {
        type: input.mimeType,
      }),
    ],
    matterId: input.matterId,
    userId: input.userId,
  });

  if (!document) {
    throw new Error("Fixture upload did not create a matter document.");
  }

  return document;
}

async function cleanupMatter(matterId: string) {
  await prisma.workflowRunStepFile.deleteMany({
    where: {
      workflowRun: {
        matterId,
      },
    },
  });
  await prisma.workflowRun.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.matterDocumentRepresentation.deleteMany({
    where: {
      document: {
        matterId,
      },
    },
  });
  await prisma.matterDocument.deleteMany({
    where: {
      matterId,
    },
  });
  await prisma.matter.delete({
    where: {
      id: matterId,
    },
  });
}

function textPdfFixture() {
  return Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >> endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
6 0 obj << /Length 44 >> stream
BT /F1 24 Tf 100 700 Td (First page text) Tj ET
endstream endobj
7 0 obj << /Length 45 >> stream
BT /F1 24 Tf 100 700 Td (Second page text) Tj ET
endstream endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000121 00000 n 
0000000241 00000 n 
0000000361 00000 n 
0000000431 00000 n 
0000000525 00000 n 
trailer << /Root 1 0 R /Size 8 >>
startxref
620
%%EOF`);
}

function imageOnlyPdfFixture() {
  return Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >> endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer << /Root 1 0 R /Size 4 >>
startxref
207
%%EOF`);
}

async function docxFixture() {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX Heading</w:t></w:r></w:p>
    <w:p><w:r><w:t>DOCX paragraph text.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`,
  );

  return zip.generateAsync({
    type: "nodebuffer",
  });
}

test("text/plain files convert to Markdown and reuse READY representations", async () => {
  const { matter, user } = await createUserAndMatter();

  try {
    const document = await uploadFixture({
      bytes: Buffer.from("Plain text notes."),
      fileName: "notes.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });
    const representation = await generateMatterDocumentMarkdown({
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    expect(representation.status).toBe(MatterDocumentRepresentationStatus.READY);
    expect(representation.content).toContain(
      `<!-- ml:document {"documentId":"${document.id}","fileName":"notes.txt","type":"text/plain"} -->`,
    );
    expect(representation.content).toContain("Plain text notes.");
    expect(representation.metadataJson).toMatchObject({
      converter: "utf8",
      pageBoundaries: false,
      sourceMimeType: "text/plain",
    });

    const reused = await generateMatterDocumentMarkdown({
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    expect(reused.id).toBe(representation.id);
    expect(reused.updatedAt.getTime()).toBe(representation.updatedAt.getTime());
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("citation source preview resolves to original uploaded document metadata", async () => {
  const { matter, user } = await createUserAndMatter();

  try {
    const document = await uploadFixture({
      bytes: Buffer.from("Plain text notes."),
      fileName: "owner-response.docx",
      matterId: matter.id,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      userId: user.id,
    });

    await prisma.matterDocumentRepresentation.create({
      data: {
        content: "This generated Markdown should stay internal.",
        matterDocumentId: document.id,
        metadataJson: {
          converter: "mammoth",
        },
        status: MatterDocumentRepresentationStatus.READY,
        type: MatterDocumentRepresentationType.MARKDOWN,
      },
    });

    const preview = await getCitationSourceDocumentPreview({
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    expect(preview).toEqual({
      originalUrl: `/api/matters/${matter.id}/documents/${document.id}/original`,
      sourceFileName: "owner-response.docx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sourceSize: Buffer.byteLength("Plain text notes."),
      title: "Citation Source",
    });
    expect(preview).not.toHaveProperty("contentMarkdown");
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("forceRegenerate replaces existing Markdown representation content", async () => {
  const { matter, user } = await createUserAndMatter();

  try {
    const document = await uploadFixture({
      bytes: Buffer.from("Original notes."),
      fileName: "force.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });
    const representation = await generateMatterDocumentMarkdown({
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    await prisma.matterDocumentContent.update({
      data: {
        bytes: Buffer.from("Updated notes."),
      },
      where: {
        matterDocumentId: document.id,
      },
    });

    const regenerated = await generateMatterDocumentMarkdown({
      forceRegenerate: true,
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    expect(regenerated.id).toBe(representation.id);
    expect(regenerated.content).toContain("Updated notes.");
    expect(regenerated.content).not.toContain("Original notes.");
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("DOCX files convert to useful Markdown", async () => {
  const { matter, user } = await createUserAndMatter();

  try {
    const document = await uploadFixture({
      bytes: await docxFixture(),
      fileName: "brief.docx",
      matterId: matter.id,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      userId: user.id,
    });
    const representation = await generateMatterDocumentMarkdown({
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    expect(representation.status).toBe(MatterDocumentRepresentationStatus.READY);
    expect(representation.content).toContain("DOCX Heading");
    expect(representation.content).toContain("DOCX paragraph text");
    expect(representation.content).toContain("Cell A");
    expect(representation.metadataJson).toMatchObject({
      converter: "mammoth",
      pageBoundaries: false,
      sourceMimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("text-native PDFs convert to page-aware Markdown", async () => {
  const { matter, user } = await createUserAndMatter();

  try {
    const document = await uploadFixture({
      bytes: textPdfFixture(),
      fileName: "Police Report.pdf",
      matterId: matter.id,
      mimeType: "application/pdf",
      userId: user.id,
    });
    const representation = await generateMatterDocumentMarkdown({
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    expect(representation.status).toBe(MatterDocumentRepresentationStatus.READY);
    expect(representation.content).toContain('<!-- ml:page {"page":1} -->');
    expect(representation.content).toContain('<!-- ml:page {"page":2} -->');
    expect(representation.content).toContain("First page text");
    expect(representation.content).toContain("Second page text");
    expect(representation.metadataJson).toMatchObject({
      converter: "pdfjs-dist",
      ocrRequired: false,
      pageBoundaries: true,
      pageCount: 2,
      sourceMimeType: "application/pdf",
    });
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("image-only PDFs and unsupported MIME types fail gracefully", async () => {
  const { matter, user } = await createUserAndMatter();

  try {
    const imageOnlyPdf = await uploadFixture({
      bytes: imageOnlyPdfFixture(),
      fileName: "scan.pdf",
      matterId: matter.id,
      mimeType: "application/pdf",
      userId: user.id,
    });
    const failedPdf = await generateMatterDocumentMarkdown({
      matterDocumentId: imageOnlyPdf.id,
      matterId: matter.id,
    });

    expect(failedPdf.status).toBe(MatterDocumentRepresentationStatus.FAILED);
    expect(failedPdf.error).toContain("OCR is not implemented yet");
    expect(failedPdf.metadataJson).toMatchObject({
      converter: "pdfjs-dist",
      ocrRequired: true,
      pageBoundaries: true,
      pageCount: 1,
      sourceMimeType: "application/pdf",
    });

    const pngDocument = await uploadFixture({
      bytes: Buffer.from("not really a png"),
      fileName: "photo.png",
      matterId: matter.id,
      mimeType: "image/png",
      userId: user.id,
    });
    const failedPng = await generateMatterDocumentMarkdown({
      matterDocumentId: pngDocument.id,
      matterId: matter.id,
    });

    expect(failedPng.status).toBe(MatterDocumentRepresentationStatus.FAILED);
    expect(failedPng.error).toBe("Unsupported file type: image/png");
  } finally {
    await cleanupMatter(matter.id);
  }
});

test("representation content is explicit and matter-scoped", async () => {
  const { matter, user } = await createUserAndMatter();
  const otherMatter = await prisma.matter.create({
    data: {
      name: `Other Representation Matter ${Date.now()}`,
    },
  });

  try {
    const document = await uploadFixture({
      bytes: Buffer.from("Scoped notes."),
      fileName: "scoped.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await ensureMatterDocumentRepresentation({
      matterDocumentId: document.id,
      matterId: matter.id,
      type: MatterDocumentRepresentationType.MARKDOWN,
    });

    const metadataOnlyDocument = await prisma.matterDocument.findUniqueOrThrow({
      where: {
        id: document.id,
      },
    });

    expect(Object.keys(metadataOnlyDocument)).not.toContain("content");

    const representation = await getMatterDocumentRepresentation({
      matterDocumentId: document.id,
      matterId: matter.id,
      type: MatterDocumentRepresentationType.MARKDOWN,
    });

    expect(representation?.content).toContain("Scoped notes.");

    await expect(
      getMatterDocumentRepresentation({
        matterDocumentId: document.id,
        matterId: otherMatter.id,
        type: MatterDocumentRepresentationType.MARKDOWN,
      }),
    ).rejects.toThrow("Matter document was not found for this matter.");

    await expect(
      ensureMatterDocumentRepresentation({
        matterDocumentId: document.id,
        matterId: otherMatter.id,
        type: MatterDocumentRepresentationType.MARKDOWN,
      }),
    ).rejects.toThrow("Matter document was not found for this matter.");
  } finally {
    await cleanupMatter(matter.id);
    await prisma.matter.delete({
      where: {
        id: otherMatter.id,
      },
    });
  }
});

test("matter documents can be deleted only from their owning matter", async () => {
  const { matter, user } = await createUserAndMatter();
  const otherMatter = await prisma.matter.create({
    data: {
      name: `Other Delete Matter ${Date.now()}`,
    },
  });

  try {
    const document = await uploadFixture({
      bytes: Buffer.from("Delete scoped notes."),
      fileName: "delete-scoped.txt",
      matterId: matter.id,
      mimeType: "text/plain",
      userId: user.id,
    });

    await ensureMatterDocumentRepresentation({
      matterDocumentId: document.id,
      matterId: matter.id,
      type: MatterDocumentRepresentationType.MARKDOWN,
    });

    await expect(
      deleteMatterDocument({
        matterDocumentId: document.id,
        matterId: otherMatter.id,
      }),
    ).rejects.toThrow("Matter document does not belong to the current matter.");

    await expect(
      prisma.matterDocument.findUnique({
        where: {
          id: document.id,
        },
      }),
    ).resolves.not.toBeNull();

    await deleteMatterDocument({
      matterDocumentId: document.id,
      matterId: matter.id,
    });

    await expect(
      prisma.matterDocument.findUnique({
        where: {
          id: document.id,
        },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.matterDocumentRepresentation.findMany({
        where: {
          matterDocumentId: document.id,
        },
      }),
    ).resolves.toHaveLength(0);
    await expect(
      prisma.matterDocumentContent.findUnique({
        where: {
          matterDocumentId: document.id,
        },
      }),
    ).resolves.toBeNull();
  } finally {
    await cleanupMatter(matter.id);
    await prisma.matter.delete({
      where: {
        id: otherMatter.id,
      },
    });
  }
});
