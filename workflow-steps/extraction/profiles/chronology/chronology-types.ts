import type { ChronologyFact } from "./schema";

export type ChronologySource = {
  extractedFactId: string;
  matterDocumentId: string;
  sourceFileName: string;
  sourcePages: number[];
  sourceQuote: string;
};

export type ChronologyCollapseInputFact = {
  id: string;
  fact: ChronologyFact;
};

export type CollapsedChronologyEventDraft = {
  actors: string[];
  confidence: "high" | "medium" | "low";
  date: string | null;
  dateText: string | null;
  isApproximateDate: boolean;
  sortKey: string;
  sourceFactIds: string[];
  sources: ChronologySource[];
  summary: string;
  title: string;
};
