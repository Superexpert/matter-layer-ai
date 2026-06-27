import type { AIService } from "@/services/ai/ai-service";

import { runChronologyExtraction } from "./extractor";

export const chronologyExtractionProfile = {
  description: "Extract dated and undated chronology facts from selected documents.",
  id: "chronology",
  label: "Chronology",
  run: runChronologyExtraction,
} as const;

export type ChronologyExtractionProfileContext = {
  aiService: Pick<AIService, "generateText">;
  readyDocuments: Array<{
    fileName: string;
    id: string;
    markdown: string;
  }>;
};
