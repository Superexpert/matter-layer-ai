import type { ExtractedFactEvidence } from "./extracted-fact";

export type CollapsedFactStatus = "conflicting" | "incomplete" | "resolved";

export type CollapsedFieldValue = {
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
};

export type CollapseSummary = {
  collapsedFactCount: number;
  conflictingCount: number;
  countsByFactType: Record<string, {
    collapsed: number;
    conflicting: number;
    raw: number;
  }>;
  rawFactCount: number;
  resolvedCount: number;
  uncollapsedCount: number;
};

export type CollapseResult = {
  collapsedFacts: CollapsedFact[];
  summary: CollapseSummary;
};
