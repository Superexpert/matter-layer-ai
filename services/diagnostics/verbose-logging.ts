import "server-only";

import type { ExtractedFact } from "@/workflow-steps/extraction/extracted-fact";
import type { CollapsedFact, CollapseSummary } from "@/workflow-steps/extraction/collapsed-fact";

export function parseBooleanEnv(
  value: string | undefined,
  defaultValue = false,
): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function isVerboseAiLoggingEnabled(): boolean {
  return parseBooleanEnv(
    process.env.MATTER_LAYER_VERBOSE_AI_LOGGING,
    false,
  );
}

export function isVerboseExtractionLoggingEnabled(): boolean {
  return parseBooleanEnv(
    process.env.MATTER_LAYER_VERBOSE_EXTRACTION_LOGGING,
    false,
  );
}

export function isVerboseAnalyzeLoggingEnabled(): boolean {
  return parseBooleanEnv(process.env.MATTER_LAYER_VERBOSE_ANALYZE_LOGGING, false);
}

export function isExtractedFactLoggingEnabled(): boolean {
  return parseBooleanEnv(
    process.env.MATTER_LAYER_LOG_EXTRACTED_FACTS,
    false,
  );
}

export function isCollapsedFactLoggingEnabled(): boolean {
  return parseBooleanEnv(
    process.env.MATTER_LAYER_LOG_COLLAPSED_FACTS,
    false,
  );
}

function logVerboseMessage(
  prefix: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (details) {
    console.log(`${prefix} ${message}`, details);
    return;
  }

  console.log(`${prefix} ${message}`);
}

export function verboseAiLog(
  prefix: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (!isVerboseAiLoggingEnabled()) {
    return;
  }

  logVerboseMessage(prefix, message, details);
}

export function verboseExtractionLog(
  prefix: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (!isVerboseExtractionLoggingEnabled()) {
    return;
  }

  logVerboseMessage(prefix, message, details);
}

export function verboseAnalyzeLog(
  prefix: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (!isVerboseAnalyzeLoggingEnabled()) {
    return;
  }

  logVerboseMessage(prefix, message, details);
}

export function logExtractedFacts(
  context: {
    completedWindowCount?: number;
    documentId: string;
    documentName: string;
    failedWindowCount?: number;
    profileId: string;
    status: string;
  },
  facts: ExtractedFact[],
): void {
  if (!isExtractedFactLoggingEnabled()) {
    return;
  }

  console.log("=== Extracted Facts ===");
  console.log(`Document: ${context.documentName}`);
  console.log(`Document ID: ${context.documentId}`);
  console.log(`Profile: ${context.profileId}`);
  console.log(`Status: ${context.status}`);

  if (context.completedWindowCount !== undefined) {
    console.log(`Completed windows: ${context.completedWindowCount}`);
  }

  if (context.failedWindowCount !== undefined) {
    console.log(`Failed windows: ${context.failedWindowCount}`);
  }

  console.log(`Fact count: ${facts.length}`);
  console.log("Facts:");
  console.log(JSON.stringify(facts, null, 2));
  console.log("=== End Extracted Facts ===");
}

export function logRejectedExtractedFact(context: {
  candidate: unknown;
  documentName: string;
  factType?: string;
  reason: string;
  windowCount?: number;
  windowIndex?: number;
}): void {
  if (!isExtractedFactLoggingEnabled()) {
    return;
  }

  console.warn("=== Rejected Extracted Fact ===");
  console.warn(`Document: ${context.documentName}`);

  if (context.windowIndex !== undefined && context.windowCount !== undefined) {
    console.warn(`Window: ${context.windowIndex} of ${context.windowCount}`);
  }

  if (context.factType) {
    console.warn(`Fact type: ${context.factType}`);
  }

  console.warn(`Reason: ${context.reason}`);
  console.warn("Candidate:");
  console.warn(JSON.stringify(context.candidate, null, 2));
  console.warn("=== End Rejected Extracted Fact ===");
}

export function logExtractionFactSummary(context: {
  completedDocumentCount: number;
  failedDocumentCount: number;
  factsByType: Record<string, number>;
  profileId: string;
  totalFactCount: number;
  workflowRunId: string;
}): void {
  if (!isExtractedFactLoggingEnabled()) {
    return;
  }

  console.log("=== Extraction Fact Summary ===");
  console.log(`Workflow run: ${context.workflowRunId}`);
  console.log(`Profile: ${context.profileId}`);
  console.log(`Documents completed: ${context.completedDocumentCount}`);
  console.log(`Documents failed: ${context.failedDocumentCount}`);
  console.log(`Total valid facts: ${context.totalFactCount}`);
  console.log("Facts by type:");

  for (const [factType, count] of Object.entries(context.factsByType)) {
    console.log(`- ${factType}: ${count}`);
  }

  console.log("=== End Extraction Fact Summary ===");
}

export function logCollapsedFacts(context: {
  collapsedFacts: CollapsedFact[];
  profileId: string;
  summary: CollapseSummary;
}): void {
  if (!isCollapsedFactLoggingEnabled()) {
    return;
  }

  console.log("=== Collapsed Facts ===");
  console.log(`Profile: ${context.profileId}`);
  console.log(`Raw fact count: ${context.summary.rawFactCount}`);
  console.log(`Collapsed fact count: ${context.summary.collapsedFactCount}`);
  console.log(`Resolved: ${context.summary.resolvedCount}`);
  console.log(`Conflicting: ${context.summary.conflictingCount}`);
  console.log(`Uncollapsed: ${context.summary.uncollapsedCount}`);
  console.log(`Narrative variants aggregated: ${context.summary.narrativeVariantCount}`);
  console.log(`Set values aggregated: ${context.summary.setValueCount}`);
  console.log(`Fallback joins: ${context.summary.fallbackJoinCount}`);
  console.log(`Ambiguous fallback facts: ${context.summary.ambiguousFallbackCount}`);
  console.log(`True conflict fields: ${context.summary.trueConflictCount}`);
  console.log("Counts by fact type:");

  for (const [factType, counts] of Object.entries(context.summary.countsByFactType)) {
    console.log(
      `- ${factType}: raw=${counts.raw}, collapsed=${counts.collapsed}, conflicting=${counts.conflicting}`,
    );
  }

  console.log(JSON.stringify(context.collapsedFacts, null, 2));
  console.log("=== End Collapsed Facts ===");
}
