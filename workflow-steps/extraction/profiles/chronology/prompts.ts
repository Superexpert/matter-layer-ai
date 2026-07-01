import type { ChronologyMarkdownWindow } from "./windowing";

export const chronologySystemPrompt = [
  "You extract sourced chronology facts for legal case preparation.",
  "Return one raw JSON object only. Do not include Markdown fences, prose, or commentary.",
  "Extract facts that belong in a legal chronology: things that happened, important document events, or legally meaningful undated facts.",
  "Each fact should describe one event or factual occurrence.",
  "Extract only facts supported by the provided source text.",
  "Do not invent facts and do not infer beyond the source text.",
  "Preserve source page numbers from <!-- ml:page {\"page\":n} --> markers.",
  "Use short source quotes that directly support each fact.",
  "Use the whole provided window; facts may begin on one page and continue on the next.",
  "Return {\"facts\":[]} if there are no relevant facts.",
  "Do not generate final chronology prose.",
  "Use natural-language labels when helpful. Do not worry about fixed legal role enums.",
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
    "{\"facts\":[{\"date\":\"YYYY-MM-DD|null\",\"dateText\":\"source date text|null\",\"summary\":\"what happened\",\"people\":[\"person names\"],\"organizations\":[\"organization names\"],\"sourceDocumentId\":\"...\",\"sourceFileName\":\"...\",\"sourcePages\":[1],\"sourceQuote\":\"exact supporting quote\",\"confidence\":\"high|medium|low|unknown\",\"labels\":[\"optional natural-language labels\"]}]}",
    "Do not wrap the JSON in ``` fences.",
    "",
    "Required fact fields:",
    "- date: normalized YYYY-MM-DD when available; otherwise null.",
    "- dateText: the original date wording when available; otherwise null.",
    "- summary: a concise factual sentence describing what happened.",
    "- people: names of people involved, or an empty array.",
    "- organizations: organizations involved, or an empty array.",
    "- sourceDocumentId, sourceFileName, sourcePages, sourceQuote: provenance for legal review.",
    "- confidence: high, medium, low, uncertain, or unknown.",
    "- labels: optional natural-language labels such as traffic stop, arrest, citation, injury, treatment, filing, or notice.",
    "",
    "Every fact must include sourcePages as an array of positive integers, for example [1] or [1,2].",
    "If a fact has no date but is legally important, include it with date null and dateText null.",
    "Do not return standalone person, organization, or taxonomy records. Return chronology facts only.",
    "",
    "Source Markdown window:",
    window.markdown,
  ].join("\n");
}
