import type { ChronologyMarkdownWindow } from "./windowing";

export const chronologySystemPrompt = [
  "You extract candidate chronology facts for legal case preparation.",
  "Return one raw JSON object only. Do not include Markdown fences, prose, or commentary.",
  "Extract only facts supported by the provided source text.",
  "Do not invent facts and do not infer beyond the source text.",
  "Preserve source page numbers from <!-- ml:page {\"page\":n} --> markers.",
  "Use short source quotes that directly support each fact.",
  "Use the whole provided window; facts may begin on one page and continue on the next.",
  "Return {\"facts\":[]} if there are no relevant facts.",
  "Do not generate final chronology prose.",
  "Avoid dates that are merely footer dates, print dates, revision dates, boilerplate disclaimer dates, unrelated legal citation dates, unrelated cited case dates, copyright dates, or irrelevant software timestamps.",
].join("\n");

export function buildChronologyUserPrompt(window: ChronologyMarkdownWindow) {
  return [
    `matterDocumentId: ${window.documentId}`,
    `sourceFileName: ${window.fileName}`,
    `windowIndex: ${window.windowIndex}`,
    `pageRange: ${window.pageStart ?? "unknown"}-${window.pageEnd ?? "unknown"}`,
    "",
    "Return JSON with this exact top-level shape:",
    "{\"facts\":[{\"factType\":\"dated_event|undated_event|person|organization|document_date\", ...}]}",
    "Do not wrap the JSON in ``` fences.",
    "",
    "Required fact fields:",
    "- dated_event: factType, date, dateText, isApproximateDate, eventSummary, actors, sourceDocumentId, sourceFileName, sourcePages, sourceQuote, confidence",
    "- undated_event: factType, eventSummary, dateClues, actors, sourceDocumentId, sourceFileName, sourcePages, sourceQuote, confidence",
    "- person: factType, name, aliases, role, sourceDocumentId, sourceFileName, sourcePages, sourceQuote, confidence. role must be one of: plaintiff, defendant, witness, attorney, judge, officer, doctor, employee, employer, other, unknown",
    "- organization: factType, name, organizationType, sourceDocumentId, sourceFileName, sourcePages, sourceQuote, confidence. organizationType must be one of: court, law_firm, law_enforcement, employer, hospital, government_agency, business, other, unknown",
    "- document_date: factType, date, dateText, dateRole, sourceDocumentId, sourceFileName, sourcePages, sourceQuote, confidence. dateRole must be one of: document_date, filing_date, signature_date, email_sent_date, email_received_date, other",
    "",
    "Every fact must include confidence as one of: high, medium, low.",
    "Every fact must include sourcePages as an array of positive integers, for example [1] or [1,2].",
    "Dates in the date field must be YYYY-MM-DD or null. Preserve the source wording in dateText.",
    "",
    "Source Markdown window:",
    window.markdown,
  ].join("\n");
}
