import { writeFile } from "node:fs/promises";

import { representativeWorkProductEditorJson } from "../tests/fixtures/docx-work-product";
import { generateDocxBlobFromEditorJson } from "../workflow-steps/document-editor/docx-export";

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error("Output DOCX path is required.");

  const blob = await generateDocxBlobFromEditorJson({
    editorJson: representativeWorkProductEditorJson,
    title: "Lawyer Memo",
  });
  await writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
}

void main();
