export type FactFieldType =
  | "boolean"
  | "date"
  | "enum"
  | "number"
  | "string";

export type FactFieldDef = {
  description?: string;
  enumValues?: string[];
  name: string;
  normalizer?: string;
  required: boolean;
  type: FactFieldType;
};

export type FactIdentityStrategy = "multiKey" | "none";

export type FactIdentityRuleCondition = Record<string, unknown>;

export type FactIdentityRule = {
  action: "merge" | "mergeWhenUnique";
  fields: string[];
  uniqueAgainst?: string[];
  when?: FactIdentityRuleCondition;
  whenNot?: FactIdentityRuleCondition;
};

export type FactFieldMergePolicy =
  | "conflict"
  | "identity"
  | "narrative"
  | "prefer-non-empty"
  | "set";

export type FactIdentityDef = {
  mergeRules?: {
    fieldPolicies?: Record<string, FactFieldMergePolicy>;
    preferNonEmptyFields?: boolean;
    preserveAlternateValues?: string[];
    rejectOnConflictFields?: string[];
  };
  rules?: FactIdentityRule[];
  scope?: "document" | "matter";
  strategy: FactIdentityStrategy;
};

export type FactExtractionDef = {
  fields: FactFieldDef[];
  instructions: string;
};

export type FactDef = {
  description?: string;
  extraction: FactExtractionDef;
  factType: string;
  identity?: FactIdentityDef;
  validate?: (
    fields: Record<string, unknown>,
    context: {
      window: ExtractionMarkdownWindow;
    },
  ) => Record<string, unknown>;
};

export type DeclarativeExtractionProfileDef = {
  description?: string;
  factDefs: FactDef[];
  id: string;
  name: string;
};
import type { ExtractionMarkdownWindow } from "./types";
