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
  confidence: "high" | "medium" | "low" | "unknown";
  date: string | null;
  dateText: string | null;
  isApproximateDate: boolean;
  organizations: string[];
  people: string[];
  sortKey: string;
  sourceFactIds: string[];
  sources: ChronologySource[];
  summary: string;
  timeText: string | null;
  title: string;
};
