import type { AIService } from "@/services/ai/ai-service";

import { runChronologyExtraction } from "./extractor";

export const chronologyExtractionProfile = {
  description: "Extract dated and undated chronology facts from selected documents.",
  id: "chronology",
  label: "Chronology",
  run: runChronologyExtraction,
} as const;

export type ChronologyExtractionWindowProgressEvent = {
  documentId: string;
  elapsedMs?: number;
  error?: string;
  errorCode?: string;
  errorProvider?: string | null;
  errorStatus?: number | null;
  errorUserMessage?: string;
  extractedFactCount?: number;
  failedWindowCount: number;
  fileName: string;
  markdownCharacterCount?: number;
  pageEnd: number | null;
  pageStart: number | null;
  promptCharacterCount?: number;
  status: "completed" | "failed" | "started" | "waiting";
  timeoutMs?: number;
  windowCount: number;
  windowIndex: number;
};

export type ChronologyExtractionProfileContext = {
  aiCallTimeoutMs?: number;
  aiHeartbeatMs?: number;
  aiService: Pick<AIService, "generateText">;
  onWindowProgress?: (
    event: ChronologyExtractionWindowProgressEvent,
  ) => Promise<void> | void;
  readyDocuments: Array<{
    fileName: string;
    id: string;
    markdown: string;
  }>;
};
