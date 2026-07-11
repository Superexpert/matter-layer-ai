import type { AnalyzeFactPacket, AnalyzeCitation } from "./compact-facts";
import { citationMarkdown } from "@/workflow-steps/document-editor/citations";

export type AppraisalReviewItem = {
  basis: string;
  citationIds: string[];
  conclusion: string;
  issue: string;
  notes: string;
};

export type AppraisalReviewGeneratorOutput = {
  items: AppraisalReviewItem[];
  summary: string;
};

export const APPRAISAL_REVIEW_RESPONSE_FORMAT = {
  name: "condemnor_appraisal_review_section",
  schema: {
    additionalProperties: false,
    properties: {
      items: { type: "array", items: { additionalProperties: false, properties: {
        basis: { type: "string" }, citationIds: { type: "array", items: { type: "string" } }, conclusion: { type: "string" }, issue: { type: "string" }, notes: { type: "string" },
      }, required: ["basis", "citationIds", "conclusion", "issue", "notes"], type: "object" } },
      summary: { type: "string" },
    },
    required: ["items", "summary"],
    type: "object",
  },
  type: "json_schema" as const,
};

export function parseAppraisalReviewGeneratorOutput(content: string): AppraisalReviewGeneratorOutput {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("Analyze generator returned invalid appraisal-review JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Analyze generator returned invalid appraisal-review data.");
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || !Array.isArray(record.items)) throw new Error("Analyze generator returned invalid appraisal-review data.");
  const items = record.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Analyze generator returned an invalid appraisal-review row.");
    const row = item as Record<string, unknown>;
    for (const key of ["basis", "conclusion", "issue", "notes"]) if (typeof row[key] !== "string") throw new Error(`Analyze appraisal-review row ${key} must be a string.`);
    if (!Array.isArray(row.citationIds) || !row.citationIds.every((id) => typeof id === "string")) throw new Error("Analyze appraisal-review row citationIds must be strings.");
    return row as AppraisalReviewItem;
  });
  return { items, summary: record.summary };
}

function citationIndex(packet: AnalyzeFactPacket) {
  const values = packet.facts.flatMap((fact) => [
    ...fact.citations,
    ...(fact.conflicts ?? []).flatMap((conflict) => conflict.values.flatMap((value) => value.citations)),
    ...Object.values(fact.supportingValues ?? {}).flatMap((items) => items.flatMap((item) => item.citations)),
  ]);
  return new Map(values.map((citation) => [citation.citationId, citation]));
}

function citations(ids: string[], index: Map<string, AnalyzeCitation>) {
  return ids.map((id) => {
    const citation = index.get(id);
    if (!citation) throw new Error(`Analyze generator cited unknown evidence: ${id}`);
    return citationMarkdown({ citedText: citation.excerpt, pageEnd: citation.pageEnd, pageStart: citation.pageStart, sourceDocumentId: citation.documentId, sourceDocumentName: citation.documentName });
  }).join(" ");
}

function cell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim() || "Not stated in the selected documents.";
}

function table(headers: string[], rows: string[][]) {
  if (!rows.length) return "The selected documents did not provide enough information for this section.";
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
}

function row(item: AppraisalReviewItem, index: Map<string, AnalyzeCitation>, mode: "standard" | "comparable") {
  const note = `${item.notes}${item.citationIds.length ? ` ${citations(item.citationIds, index)}` : ""}`;
  return mode === "comparable"
    ? [item.issue, item.conclusion, "", item.basis, note]
    : [item.issue, item.conclusion, item.basis, note];
}

export function renderCondemnorAppraisalReview(input: {
  packet: AnalyzeFactPacket;
  results: Record<string, AppraisalReviewGeneratorOutput>;
}) {
  const index = citationIndex(input.packet);
  const valuation = input.results["valuation-summary"] ?? { items: [], summary: "" };
  const impacts = input.results["assumptions-impacts"] ?? { items: [], summary: "" };
  const comparables = input.results["comparable-sales"] ?? { items: [], summary: "" };
  const questions = input.results["missing-evidence-questions"] ?? { items: [], summary: "" };
  const executive = input.results["executive-summary"] ?? { items: [], summary: "" };
  const questionList = (pattern?: RegExp) => questions.items
    .filter((item) => !pattern || pattern.test(`${item.issue} ${item.notes}`))
    .map((item) => `* **${cell(item.issue)}:** ${cell(item.notes || item.conclusion)}${item.citationIds.length ? ` ${citations(item.citationIds, index)}` : ""}`).join("\n");
  const executiveText = [executive.summary, ...executive.items.map((item) => `${item.conclusion || item.notes}${item.citationIds.length ? ` ${citations(item.citationIds, index)}` : ""}`)].filter(Boolean).join("\n\n");
  return [
    "# Condemnor Appraisal Review",
    "This review summarizes and analyzes the selected documents for attorney review. It is not an independent appraisal or a substitute for advice from a qualified valuation expert.",
    "## Executive Summary", executiveText || "The selected documents did not provide enough information for an executive summary.",
    "## Valuation Snapshot", table(["Issue", "Appraiser Conclusion", "Supporting Basis", "Review Notes"], valuation.items.map((item) => row(item, index, "standard"))),
    "## Highest and Best Use", valuation.items.filter((item) => /highest|best use/i.test(item.issue)).map((item) => `${item.conclusion} ${citations(item.citationIds, index)}`).join("\n\n") || "Not stated in the selected documents.",
    "## Property and Acquisition Summary", valuation.summary || "Not stated in the selected documents.",
    "## Assumptions and Conditions", table(["Assumption or Condition", "Appraiser Position", "Supporting Basis", "Review Notes"], impacts.items.filter((item) => /assum|condition|plan|configuration/i.test(`${item.issue} ${item.notes}`)).map((item) => row(item, index, "standard"))),
    "## Treatment of Property Impacts", table(["Issue", "Appraiser Conclusion", "Supporting Basis", "Questions for Counsel"], impacts.items.map((item) => row(item, index, "standard"))),
    "## Comparable Sales Review", table(["Comparable", "Sale Date / Price", "Material Adjustments", "Review Notes", ""], comparables.items.map((item) => row(item, index, "comparable"))),
    "## Remainder Damages Analysis", valuation.items.filter((item) => /remainder/i.test(item.issue)).map((item) => `${item.conclusion} ${item.notes} ${citations(item.citationIds, index)}`).join("\n\n") || "Not stated in the selected documents.",
    "## Missing or Unresolved Evidence", questions.summary || "No missing evidence was expressly identified in the selected documents.",
    "## Questions for Counsel", questionList(/counsel|legal|review/i) || questionList() || "No supported review questions were generated.",
    "## Questions for the Property Owner", questionList(/owner|tenant|operation/i) || "No supported owner questions were generated.",
    "## Questions for the Appraiser", questionList(/appraiser|workfile|adjustment|method/i) || "No supported appraiser questions were generated.",
    "## Suggested Next Steps", questionList(/next|investigat|expert|obtain|confirm/i) || "Review the cited appraisal conclusions and determine whether additional factual or expert investigation is warranted.",
  ].join("\n\n");
}
