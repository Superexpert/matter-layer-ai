import { createHash } from "node:crypto";

import type {
  CollapsedFact,
  CollapsedFactConflict,
  CollapsedFieldValue,
  CollapseResult,
  CollapseSummary,
} from "../collapsed-fact";
import type { ExtractedFact } from "../extracted-fact";
import type {
  FactDef,
  FactFieldDef,
  FactFieldMergePolicy,
  FactIdentityRule,
} from "../fact-def";
import { dedupeEvidence } from "./evidence";
import { normalizeFieldValue, normalizedField } from "./normalizers";

type ClusterSeed = {
  fact: ExtractedFact;
  identityValues?: Record<string, string>;
  identityKey: string;
  matchedFields?: string[];
  ruleIndex?: number;
  strategy: string;
};

type Cluster = {
  identityValues?: Record<string, string>;
  identityKey: string;
  matchedFields?: string[];
  ruleIndex?: number;
  seeds: ClusterSeed[];
  strategy: string;
};

type CollapseDiagnostics = {
  ambiguousFallbackCount: number;
  fallbackJoinCount: number;
  narrativeVariantCount: number;
  setValueCount: number;
  trueConflictCount: number;
};

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function valueKey(value: unknown) {
  return JSON.stringify(value);
}

function fieldDefByName(factDef: FactDef) {
  return new Map(factDef.extraction.fields.map((field) => [field.name, field]));
}

function normalizedValueForField(input: {
  fieldDef?: FactFieldDef;
  fieldName: string;
  fact: ExtractedFact;
}) {
  return normalizedField(
    input.fact.fields[input.fieldName],
    input.fieldDef?.normalizer,
  )?.normalizedValue;
}

function hasAllRuleFields(input: {
  fieldDefs: Map<string, FactFieldDef>;
  fact: ExtractedFact;
  rule: FactIdentityRule;
}) {
  return input.rule.fields.every((fieldName) => {
    const normalized = normalizedValueForField({
      fact: input.fact,
      fieldDef: input.fieldDefs.get(fieldName),
      fieldName,
    });

    return normalized !== undefined && normalized !== null && normalized !== "";
  });
}

function conditionMatches(input: {
  condition: Record<string, unknown> | undefined;
  fieldDefs: Map<string, FactFieldDef>;
  fact: ExtractedFact;
}) {
  if (!input.condition) {
    return true;
  }

  return Object.entries(input.condition).every(([fieldName, expectedValue]) => {
    const fieldDef = input.fieldDefs.get(fieldName);
    const actual = normalizedValueForField({
      fact: input.fact,
      fieldDef,
      fieldName,
    });
    const expected = normalizeFieldValue(expectedValue, fieldDef?.normalizer);

    return valueKey(actual) === valueKey(expected);
  });
}

function ruleApplies(input: {
  fieldDefs: Map<string, FactFieldDef>;
  fact: ExtractedFact;
  rule: FactIdentityRule;
}) {
  if (!conditionMatches({
    condition: input.rule.when,
    fact: input.fact,
    fieldDefs: input.fieldDefs,
  })) {
    return false;
  }

  if (input.rule.whenNot && conditionMatches({
    condition: input.rule.whenNot,
    fact: input.fact,
    fieldDefs: input.fieldDefs,
  })) {
    return false;
  }

  return hasAllRuleFields(input);
}

function identityKeyForRule(input: {
  fact: ExtractedFact;
  fieldDefs: Map<string, FactFieldDef>;
  profileId: string;
  rule: FactIdentityRule;
}) {
  const parts = input.rule.fields.map((fieldName) => {
    const normalized = normalizedValueForField({
      fact: input.fact,
      fieldDef: input.fieldDefs.get(fieldName),
      fieldName,
    });

    return [fieldName, normalized] as const;
  });

  return JSON.stringify({
    factType: input.fact.factType,
    fields: parts,
    profileId: input.profileId,
  });
}

function identityValuesForRule(input: {
  fact: ExtractedFact;
  fieldDefs: Map<string, FactFieldDef>;
  rule: FactIdentityRule;
}) {
  const values: Record<string, string> = {};

  for (const fieldName of input.rule.fields) {
    const normalized = normalizedValueForField({
      fact: input.fact,
      fieldDef: input.fieldDefs.get(fieldName),
      fieldName,
    });

    if (normalized !== undefined && normalized !== null && normalized !== "") {
      values[fieldName] = valueKey(normalized);
    }
  }

  return values;
}

function uniqueAgainstValues(input: {
  fact: ExtractedFact;
  fieldDefs: Map<string, FactFieldDef>;
  rule: FactIdentityRule;
}) {
  return (input.rule.uniqueAgainst ?? []).flatMap((fieldName) => {
    const normalized = normalizedValueForField({
      fact: input.fact,
      fieldDef: input.fieldDefs.get(fieldName),
      fieldName,
    });

    return normalized === undefined || normalized === null || normalized === ""
      ? []
      : [[fieldName, normalized] as const];
  });
}

function mergeWhenUniqueAmbiguous(input: {
  candidates: ExtractedFact[];
  fieldDefs: Map<string, FactFieldDef>;
  rule: FactIdentityRule;
}) {
  const valuesByField = new Map<string, Set<string>>();

  for (const fact of input.candidates) {
    for (const [fieldName, normalized] of uniqueAgainstValues({
      fact,
      fieldDefs: input.fieldDefs,
      rule: input.rule,
    })) {
      const values = valuesByField.get(fieldName) ?? new Set<string>();
      values.add(valueKey(normalized));
      valuesByField.set(fieldName, values);
    }
  }

  return [...valuesByField.values()].some((values) => values.size > 1);
}

function ruleSeedForFact(input: {
  fact: ExtractedFact;
  factDef: FactDef;
  profileId: string;
  rule: FactIdentityRule;
  ruleIndex: number;
}) {
  const identity = input.factDef.identity;

  if (!identity || identity.strategy === "none") {
    return null;
  }

  const fieldDefs = fieldDefByName(input.factDef);
  if (!ruleApplies({
    fact: input.fact,
    fieldDefs,
    rule: input.rule,
  })) {
    return null;
  }

  return {
    fact: input.fact,
    identityKey: identityKeyForRule({
      fact: input.fact,
      fieldDefs,
      profileId: input.profileId,
      rule: input.rule,
    }),
    identityValues: identityValuesForRule({
      fact: input.fact,
      fieldDefs,
      rule: input.rule,
    }),
    matchedFields: input.rule.fields,
    ruleIndex: input.ruleIndex,
    strategy: identity.strategy,
  } satisfies ClusterSeed;
}

function clusteredSeeds(input: {
  diagnostics: CollapseDiagnostics;
  factDef: FactDef;
  facts: ExtractedFact[];
  profileId: string;
}) {
  const fieldDefs = fieldDefByName(input.factDef);
  const rules = input.factDef.identity?.rules ?? [];
  const clusters: Cluster[] = [];
  const uncollapsed: Cluster[] = [];
  const assignedFactIds = new Set<string>();

  function incompleteCluster(seed: ClusterSeed): Cluster {
    return {
      identityKey: JSON.stringify({
        identityKey: seed.identityKey,
        sourceFactId: seed.fact.id,
      }),
      identityValues: seed.identityValues,
      matchedFields: seed.matchedFields,
      ruleIndex: seed.ruleIndex,
      seeds: [seed],
      strategy: "none",
    };
  }

  function compatibleClusters(seed: ClusterSeed) {
    return clusters.filter((cluster) => {
      if (cluster.ruleIndex === undefined || seed.ruleIndex === undefined) {
        return false;
      }

      if (cluster.ruleIndex >= seed.ruleIndex) {
        return false;
      }

      return (seed.matchedFields ?? []).every((fieldName) => {
        const seedValue = seed.identityValues?.[fieldName];
        const clusterValue = cluster.identityValues?.[fieldName];

        return seedValue !== undefined && clusterValue !== undefined && seedValue === clusterValue;
      });
    });
  }

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
    const rule = rules[ruleIndex]!;
    const seeds = input.facts.flatMap((fact) => {
      if (assignedFactIds.has(fact.id)) {
        return [];
      }

      const seed = ruleSeedForFact({
        fact,
        factDef: input.factDef,
        profileId: input.profileId,
        rule,
        ruleIndex,
      });

      return seed ? [seed] : [];
    });

    const seedsByKey = new Map<string, ClusterSeed[]>();

    for (const seed of seeds) {
      if (rule.action === "mergeWhenUnique") {
        const matches = compatibleClusters(seed);

        if (matches.length === 1) {
          matches[0]!.seeds.push(seed);
          assignedFactIds.add(seed.fact.id);
          input.diagnostics.fallbackJoinCount += 1;
          continue;
        }

        if (matches.length > 1) {
          uncollapsed.push(incompleteCluster(seed));
          assignedFactIds.add(seed.fact.id);
          input.diagnostics.ambiguousFallbackCount += 1;
          continue;
        }
      }

      const keyedSeeds = seedsByKey.get(seed.identityKey) ?? [];
      keyedSeeds.push(seed);
      seedsByKey.set(seed.identityKey, keyedSeeds);
    }

    for (const [identityKey, keyedSeeds] of seedsByKey.entries()) {
      if (
        rule.action === "mergeWhenUnique" &&
        mergeWhenUniqueAmbiguous({
          candidates: keyedSeeds.map((seed) => seed.fact),
          fieldDefs,
          rule,
        })
      ) {
        for (const seed of keyedSeeds) {
          uncollapsed.push(incompleteCluster(seed));
          assignedFactIds.add(seed.fact.id);
          input.diagnostics.ambiguousFallbackCount += 1;
        }
        continue;
      }

      const cluster = clusters.find((item) => item.identityKey === identityKey);

      if (cluster) {
        cluster.seeds.push(...keyedSeeds);
      } else {
        clusters.push({
          identityKey,
          identityValues: keyedSeeds[0]?.identityValues,
          matchedFields: keyedSeeds[0]?.matchedFields,
          ruleIndex: keyedSeeds[0]?.ruleIndex,
          seeds: keyedSeeds,
          strategy: keyedSeeds[0]?.strategy ?? "none",
        });
      }

      for (const seed of keyedSeeds) {
        assignedFactIds.add(seed.fact.id);
      }
    }
  }

  for (const fact of input.facts) {
    if (!assignedFactIds.has(fact.id)) {
      uncollapsed.push({
        identityKey: JSON.stringify({
          factType: fact.factType,
          profileId: input.profileId,
          sourceFactId: fact.id,
          strategy: "none",
        }),
        seeds: [{
          fact,
          identityKey: fact.id,
          strategy: "none",
        }],
        strategy: "none",
      });
    }
  }

  return [...clusters, ...uncollapsed];
}

function groupedValuesForField(input: {
  facts: ExtractedFact[];
  fieldDef?: FactFieldDef;
  fieldName: string;
}) {
  const values = new Map<string, CollapsedFieldValue>();

  for (const fact of input.facts) {
    const value = fact.fields[input.fieldName];

    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      continue;
    }

    const normalized = normalizedField(value, input.fieldDef?.normalizer);
    const normalizedValue = normalized?.normalizedValue;
    const key = normalizedValue === undefined
      ? `raw:${valueKey(value)}`
      : valueKey(normalizedValue);
    const existing = values.get(key) ?? {
      ...(normalized?.canonicalValue === undefined
        ? {}
        : { canonicalValue: normalized.canonicalValue }),
      evidence: [],
      normalizedValue,
      sourceFactIds: [],
      value,
    };

    existing.sourceFactIds.push(fact.id);
    existing.evidence.push(fact.evidence);

    if (String(value).length > String(existing.value).length) {
      existing.value = value;
    }

    values.set(key, existing);
  }

  return [...values.values()].map((value) => ({
    ...value,
    evidence: dedupeEvidence(value.evidence),
    sourceFactIds: [...new Set(value.sourceFactIds)].sort(),
  }));
}

function resolvedValue(value: CollapsedFieldValue) {
  return value.canonicalValue ?? value.value;
}

function fieldPolicy(input: {
  factDef: FactDef;
  fieldName: string;
  matchedFields?: string[];
}): FactFieldMergePolicy {
  const explicitPolicy = input.factDef.identity?.mergeRules?.fieldPolicies?.[input.fieldName];

  if (explicitPolicy) {
    return explicitPolicy;
  }

  if (input.matchedFields?.includes(input.fieldName)) {
    return "identity";
  }

  if (input.factDef.identity?.mergeRules?.preserveAlternateValues?.includes(input.fieldName)) {
    return "narrative";
  }

  if (input.factDef.identity?.mergeRules?.preferNonEmptyFields) {
    return "prefer-non-empty";
  }

  return "conflict";
}

function mergeCluster(input: {
  cluster: Cluster;
  diagnostics: CollapseDiagnostics;
  factDef: FactDef;
  profileId: string;
}): CollapsedFact[] {
  const facts = input.cluster.seeds.map((seed) => seed.fact);
  const fieldDefs = input.factDef.extraction.fields;
  const rejectOnConflictFields = new Set(
    input.factDef.identity?.mergeRules?.rejectOnConflictFields ?? [],
  );
  const fields: Record<string, unknown> = {};
  const conflicts: CollapsedFactConflict[] = [];
  const supportingValues: Record<string, CollapsedFieldValue[]> = {};

  for (const fieldDef of fieldDefs) {
    const values = groupedValuesForField({
      facts,
      fieldDef,
      fieldName: fieldDef.name,
    });

    if (values.length === 0) {
      continue;
    }

    if (values.length === 1) {
      fields[fieldDef.name] = resolvedValue(values[0]!);
      continue;
    }

    const policy = fieldPolicy({
      factDef: input.factDef,
      fieldName: fieldDef.name,
      matchedFields: input.cluster.matchedFields,
    });

    if (policy === "narrative") {
      fields[fieldDef.name] = values[0]!.value;
      supportingValues[fieldDef.name] = values;
      input.diagnostics.narrativeVariantCount += values.length;
      continue;
    }

    if (policy === "set") {
      fields[fieldDef.name] = values.map((value) => value.value);
      supportingValues[fieldDef.name] = values;
      input.diagnostics.setValueCount += values.length;
      continue;
    }

    if (rejectOnConflictFields.has(fieldDef.name)) {
      return facts.flatMap((fact) =>
        mergeCluster({
          cluster: {
            identityKey: JSON.stringify({
              identityKey: input.cluster.identityKey,
              rejectOnConflictField: fieldDef.name,
              sourceFactId: fact.id,
            }),
            identityValues: input.cluster.identityValues,
            matchedFields: input.cluster.matchedFields,
            ruleIndex: input.cluster.ruleIndex,
            seeds: [{
              fact,
              identityKey: fact.id,
              identityValues: input.cluster.identityValues,
              matchedFields: input.cluster.matchedFields,
              ruleIndex: input.cluster.ruleIndex,
              strategy: input.cluster.strategy,
            }],
            strategy: input.cluster.strategy,
          },
          diagnostics: input.diagnostics,
          factDef: input.factDef,
          profileId: input.profileId,
        }),
      );
    }

    conflicts.push({
      field: fieldDef.name,
      values,
    });
    input.diagnostics.trueConflictCount += 1;
  }

  const evidence = dedupeEvidence(facts.map((fact) => fact.evidence));
  const sourceFactIds = facts.map((fact) => fact.id).sort();
  const status = conflicts.length > 0
    ? "conflicting"
    : input.cluster.strategy === "none"
      ? "incomplete"
      : "resolved";
  const identityKey = input.cluster.identityKey;

  const collapsedFact: CollapsedFact = {
    conflicts,
    evidence,
    factType: facts[0]?.factType ?? input.factDef.factType,
    fields,
    id: `collapsed_${stableHash(`${input.profileId}:${identityKey}`)}`,
    identity: {
      matchedFields: input.cluster.matchedFields,
      ruleIndex: input.cluster.ruleIndex,
      strategy: input.cluster.strategy,
    },
    identityKey,
    sourceFactIds,
    status,
  };

  if (Object.keys(supportingValues).length > 0) {
    collapsedFact.supportingValues = supportingValues;
  }

  return [collapsedFact];
}

function emptySummary(rawFactCount: number): CollapseSummary {
  return {
    ambiguousFallbackCount: 0,
    collapsedFactCount: 0,
    conflictingCount: 0,
    countsByFactType: {},
    fallbackJoinCount: 0,
    narrativeVariantCount: 0,
    rawFactCount,
    resolvedCount: 0,
    setValueCount: 0,
    trueConflictCount: 0,
    uncollapsedCount: 0,
  };
}

export function collapseExtractedFacts(input: {
  factDefs: FactDef[];
  facts: ExtractedFact[];
  profileId: string;
}): CollapseResult {
  const factDefsByType = new Map(input.factDefs.map((factDef) => [factDef.factType, factDef]));
  const factsByType = new Map<string, ExtractedFact[]>();

  for (const fact of input.facts) {
    const facts = factsByType.get(fact.factType) ?? [];
    facts.push(fact);
    factsByType.set(fact.factType, facts);
  }

  const collapsedFacts: CollapsedFact[] = [];
  const summary = emptySummary(input.facts.length);
  const diagnostics: CollapseDiagnostics = {
    ambiguousFallbackCount: 0,
    fallbackJoinCount: 0,
    narrativeVariantCount: 0,
    setValueCount: 0,
    trueConflictCount: 0,
  };

  for (const [factType, facts] of [...factsByType.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const factDef = factDefsByType.get(factType);

    if (!factDef) {
      continue;
    }

    const clusters = clusteredSeeds({
      diagnostics,
      factDef,
      facts,
      profileId: input.profileId,
    });
    const typeCollapsedFacts = clusters.flatMap((cluster) =>
      mergeCluster({
        cluster,
        diagnostics,
        factDef,
        profileId: input.profileId,
      }),
    ).sort((left, right) => left.identityKey.localeCompare(right.identityKey));

    collapsedFacts.push(...typeCollapsedFacts);
    summary.countsByFactType[factType] = {
      collapsed: typeCollapsedFacts.length,
      conflicting: typeCollapsedFacts.filter((fact) => fact.status === "conflicting").length,
      raw: facts.length,
    };
  }

  summary.collapsedFactCount = collapsedFacts.length;
  summary.conflictingCount = collapsedFacts.filter((fact) => fact.status === "conflicting").length;
  summary.ambiguousFallbackCount = diagnostics.ambiguousFallbackCount;
  summary.fallbackJoinCount = diagnostics.fallbackJoinCount;
  summary.narrativeVariantCount = diagnostics.narrativeVariantCount;
  summary.resolvedCount = collapsedFacts.filter((fact) => fact.status === "resolved").length;
  summary.setValueCount = diagnostics.setValueCount;
  summary.trueConflictCount = diagnostics.trueConflictCount;
  summary.uncollapsedCount = collapsedFacts.filter((fact) => fact.status === "incomplete").length;

  return {
    collapsedFacts,
    summary,
  };
}
