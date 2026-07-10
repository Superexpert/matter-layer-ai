import { createHash } from "node:crypto";

import type {
  CollapsedFact,
  CollapsedFactConflict,
  CollapsedFieldValue,
  CollapseResult,
  CollapseSummary,
} from "../collapsed-fact";
import type { ExtractedFact } from "../extracted-fact";
import type { FactDef, FactFieldDef, FactIdentityRule } from "../fact-def";
import { dedupeEvidence } from "./evidence";
import { normalizeFieldValue, normalizedField } from "./normalizers";

type ClusterSeed = {
  fact: ExtractedFact;
  identityKey: string;
  matchedFields?: string[];
  ruleIndex?: number;
  strategy: string;
};

type Cluster = {
  identityKey: string;
  matchedFields?: string[];
  ruleIndex?: number;
  seeds: ClusterSeed[];
  strategy: string;
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
}) {
  const identity = input.factDef.identity;

  if (!identity || identity.strategy === "none") {
    return null;
  }

  const fieldDefs = fieldDefByName(input.factDef);
  const rules = identity.rules ?? [];

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
    const rule = rules[ruleIndex]!;

    if (!ruleApplies({
      fact: input.fact,
      fieldDefs,
      rule,
    })) {
      continue;
    }

    return {
      fact: input.fact,
      identityKey: identityKeyForRule({
        fact: input.fact,
        fieldDefs,
        profileId: input.profileId,
        rule,
      }),
      matchedFields: rule.fields,
      ruleIndex,
      strategy: identity.strategy,
    } satisfies ClusterSeed;
  }

  return null;
}

function clusteredSeeds(input: {
  factDef: FactDef;
  facts: ExtractedFact[];
  profileId: string;
}) {
  const seeds = input.facts.map((fact) =>
    ruleSeedForFact({
      fact,
      factDef: input.factDef,
      profileId: input.profileId,
    }),
  );
  const fieldDefs = fieldDefByName(input.factDef);
  const rules = input.factDef.identity?.rules ?? [];
  const clustersByKey = new Map<string, Cluster>();
  const uncollapsed: Cluster[] = [];

  for (const seed of seeds) {
    if (!seed) {
      continue;
    }

    const cluster = clustersByKey.get(seed.identityKey) ?? {
      identityKey: seed.identityKey,
      matchedFields: seed.matchedFields,
      ruleIndex: seed.ruleIndex,
      seeds: [],
      strategy: seed.strategy,
    };
    cluster.seeds.push(seed);
    clustersByKey.set(seed.identityKey, cluster);
  }

  for (const [identityKey, cluster] of [...clustersByKey.entries()]) {
    const rule = cluster.ruleIndex === undefined ? undefined : rules[cluster.ruleIndex];

    if (
      rule?.action === "mergeWhenUnique" &&
      mergeWhenUniqueAmbiguous({
        candidates: cluster.seeds.map((seed) => seed.fact),
        fieldDefs,
        rule,
      })
    ) {
      clustersByKey.delete(identityKey);
      for (const seed of cluster.seeds) {
        uncollapsed.push({
          identityKey: JSON.stringify({
            identityKey: seed.identityKey,
            sourceFactId: seed.fact.id,
          }),
          matchedFields: seed.matchedFields,
          ruleIndex: seed.ruleIndex,
          seeds: [seed],
          strategy: seed.strategy,
        });
      }
    }
  }

  const clusteredFactIds = new Set(
    [...clustersByKey.values(), ...uncollapsed].flatMap((cluster) =>
      cluster.seeds.map((seed) => seed.fact.id),
    ),
  );

  for (const fact of input.facts) {
    if (!clusteredFactIds.has(fact.id)) {
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

  return [...clustersByKey.values(), ...uncollapsed];
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

    const normalizedValue = normalizeFieldValue(value, input.fieldDef?.normalizer);
    const key = valueKey(normalizedValue);
    const existing = values.get(key) ?? {
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

function mergeCluster(input: {
  cluster: Cluster;
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
      fields[fieldDef.name] = values[0]!.value;
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
            matchedFields: input.cluster.matchedFields,
            ruleIndex: input.cluster.ruleIndex,
            seeds: [{
              fact,
              identityKey: fact.id,
              matchedFields: input.cluster.matchedFields,
              ruleIndex: input.cluster.ruleIndex,
              strategy: input.cluster.strategy,
            }],
            strategy: input.cluster.strategy,
          },
          factDef: input.factDef,
          profileId: input.profileId,
        }),
      );
    }

    conflicts.push({
      field: fieldDef.name,
      values,
    });
  }

  const evidence = dedupeEvidence(facts.map((fact) => fact.evidence));
  const sourceFactIds = facts.map((fact) => fact.id).sort();
  const status = conflicts.length > 0
    ? "conflicting"
    : input.cluster.strategy === "none"
      ? "incomplete"
      : "resolved";
  const identityKey = input.cluster.identityKey;

  return [
    {
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
    },
  ];
}

function emptySummary(rawFactCount: number): CollapseSummary {
  return {
    collapsedFactCount: 0,
    conflictingCount: 0,
    countsByFactType: {},
    rawFactCount,
    resolvedCount: 0,
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

  for (const [factType, facts] of [...factsByType.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const factDef = factDefsByType.get(factType);

    if (!factDef) {
      continue;
    }

    const clusters = clusteredSeeds({
      factDef,
      facts,
      profileId: input.profileId,
    });
    const typeCollapsedFacts = clusters.flatMap((cluster) =>
      mergeCluster({
        cluster,
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
  summary.resolvedCount = collapsedFacts.filter((fact) => fact.status === "resolved").length;
  summary.uncollapsedCount = collapsedFacts.filter((fact) => fact.status === "incomplete").length;

  return {
    collapsedFacts,
    summary,
  };
}
