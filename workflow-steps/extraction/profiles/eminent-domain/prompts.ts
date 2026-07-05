import type { ExtractionMarkdownWindow } from "../../types";

export const eminentDomainSystemPrompt = [
  "You extract structured eminent domain case assessment information for lawyer review.",
  "Use only the supplied source document text.",
  "Do not provide legal advice or conclusions beyond what the documents support.",
  "Preserve uncertainty with concise source citations and confidence values.",
  "Return JSON only.",
].join("\n");

export function buildEminentDomainUserPrompt(window: ExtractionMarkdownWindow) {
  return [
    "Extract eminent domain case assessment information from this source document.",
    "",
    `matterDocumentId: ${window.documentId}`,
    `sourceFileName: ${window.fileName}`,
    window.pageStart && window.pageEnd
      ? `pageRange: ${window.pageStart}-${window.pageEnd}`
      : "pageRange: unknown",
    "",
    "Return a JSON object with an assessments array. Each assessment may include:",
    "- matterOverview",
    "- timeline",
    "- takingSummary",
    "- valuationSummary",
    "- proceduralFlags",
    "- missingDocuments",
    "- recommendedNextActions",
    "",
    "For timeline entries, include event and optional date, sourceCitation, and confidence.",
    "For procedural flags, include issue, explanation, optional severity, and sourceCitation.",
    "Use concise strings. Omit fields that are not supported by the document.",
    "",
    "Source document text:",
    window.markdown,
  ].join("\n");
}
