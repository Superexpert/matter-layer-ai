type MatterDocumentDisplayNameInput = {
  documentSection: "sourceDocument" | "workProduct";
  fileName: string;
};

export function getMatterDocumentDisplayName(document: MatterDocumentDisplayNameInput) {
  if (document.documentSection !== "workProduct") {
    return document.fileName;
  }

  return document.fileName.replace(/\.md$/i, "");
}
