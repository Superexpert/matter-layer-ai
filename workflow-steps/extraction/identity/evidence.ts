import type { ExtractedFactEvidence } from "../extracted-fact";

function evidenceKey(evidence: ExtractedFactEvidence) {
  return JSON.stringify({
    documentDate: evidence.documentDate ?? null,
    documentDateSource: evidence.documentDateSource ?? null,
    documentId: evidence.documentId,
    documentName: evidence.documentName,
    excerpt: evidence.excerpt ?? null,
    pageEnd: evidence.pageEnd ?? null,
    pageStart: evidence.pageStart ?? null,
  });
}

export function dedupeEvidence(
  evidenceItems: ExtractedFactEvidence[],
): ExtractedFactEvidence[] {
  const evidenceByKey = new Map<string, ExtractedFactEvidence>();

  for (const evidence of evidenceItems) {
    evidenceByKey.set(evidenceKey(evidence), evidence);
  }

  return [...evidenceByKey.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([, evidence]) => evidence);
}
