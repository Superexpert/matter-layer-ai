import type { ExtractedFactEvidence } from "./extracted-fact";

export type CollapsedFactStatus = "conflicting" | "incomplete" | "resolved";

export type CollapsedFieldValue = {
  canonicalValue?: unknown;
  evidence: ExtractedFactEvidence[];
  normalizedValue?: unknown;
  sourceFactIds: string[];
  value: unknown;
};

export type CollapsedFactConflict = {
  field: string;
  values: CollapsedFieldValue[];
};

export type CollapsedFact = {
  conflicts: CollapsedFactConflict[];
  evidence: ExtractedFactEvidence[];
  factType: string;
  fields: Record<string, unknown>;
  id: string;
  identity: {
    matchedFields?: string[];
    ruleIndex?: number;
    strategy: string;
  };
  identityKey: string;
  sourceFactIds: string[];
  status: CollapsedFactStatus;
  supportingValues?: Record<string, CollapsedFieldValue[]>;
};

export type CollapseSummary = {
  ambiguousFallbackCount: number;
  collapsedFactCount: number;
  conflictingCount: number;
  countsByFactType: Record<string, {
    collapsed: number;
    conflicting: number;
    raw: number;
  }>;
  fallbackJoinCount: number;
  narrativeVariantCount: number;
  rawFactCount: number;
  resolvedCount: number;
  setValueCount: number;
  trueConflictCount: number;
  uncollapsedCount: number;
};

export type CollapseResult = {
  collapsedFacts: CollapsedFact[];
  summary: CollapseSummary;
};
