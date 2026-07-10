export type ExtractedFactConfidence = "high" | "low" | "medium";

export type ExtractedFactEvidence = {
  documentDate?: string;
  documentDateSource?: string;
  documentId: string;
  documentName: string;
  excerpt?: string;
  pageEnd?: number;
  pageStart?: number;
};

export type ExtractedFact = {
  evidence: ExtractedFactEvidence;
  extractionConfidence?: ExtractedFactConfidence;
  factType: string;
  fields: Record<string, unknown>;
  id: string;
};

export type ExtractedDocumentResult = {
  documentId: string;
  documentName: string;
  error?: string;
  facts: ExtractedFact[];
  status: "completed" | "failed";
  warnings: string[];
};
