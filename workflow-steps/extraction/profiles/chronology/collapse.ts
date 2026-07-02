import type {
  ChronologyCollapseInputFact,
  ChronologySource,
  CollapsedChronologyEventDraft,
} from "./chronology-types";
import type { ChronologyFact } from "./schema";
import { chronologyFactSortKey } from "./schema";

const CONFIDENCE_RANK = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
} as const;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "near",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "with",
]);

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizedText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function jaccardSimilarity(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);

  if (union.size === 0) {
    return 0;
  }

  let intersectionCount = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersectionCount += 1;
    }
  }

  return intersectionCount / union.size;
}

function peopleOverlap(left: string[], right: string[]) {
  const leftPeople = new Set(left.map(normalizedText).filter(Boolean));
  const rightPeople = new Set(right.map(normalizedText).filter(Boolean));

  if (leftPeople.size === 0 || rightPeople.size === 0) {
    return false;
  }

  return [...leftPeople].some((person) => rightPeople.has(person));
}

function sourceFromFact(input: ChronologyCollapseInputFact): ChronologySource {
  return {
    extractedFactId: input.id,
    matterDocumentId: input.fact.sourceDocumentId,
    sourceFileName: input.fact.sourceFileName,
    sourcePages: input.fact.sourcePages,
    sourceQuote: input.fact.sourceQuote,
  };
}

function confidenceForFacts(facts: ChronologyFact[]) {
  return facts.reduce<"high" | "medium" | "low" | "unknown">((lowestConfidence, fact) => {
    if (CONFIDENCE_RANK[fact.confidence] < CONFIDENCE_RANK[lowestConfidence]) {
      return fact.confidence;
    }

    return lowestConfidence;
  }, "high");
}

function titleForSummary(summary: string) {
  const trimmedSummary = summary.trim();
  if (trimmedSummary.length <= 80) {
    return trimmedSummary;
  }

  return `${trimmedSummary.slice(0, 77).trim()}...`;
}

function eventDraftFromFacts(facts: ChronologyCollapseInputFact[]): CollapsedChronologyEventDraft {
  const primaryFact = facts[0].fact;
  const sourceFacts = facts.map((fact) => fact.fact);
  const people = uniqueStrings(sourceFacts.flatMap((fact) => fact.people));
  const organizations = uniqueStrings(
    sourceFacts.flatMap((fact) => fact.organizations),
  );

  return {
    confidence: confidenceForFacts(sourceFacts),
    date: primaryFact.date,
    dateText: primaryFact.dateText,
    isApproximateDate: primaryFact.isApproximateDate ?? false,
    organizations,
    people,
    sortKey: chronologyFactSortKey(primaryFact),
    sourceFactIds: facts.map((fact) => fact.id),
    sources: facts.map(sourceFromFact),
    summary: primaryFact.summary,
    timeText: primaryFact.timeText ?? null,
    title: titleForSummary(primaryFact.summary),
  };
}

function shouldCollapse(
  existing: CollapsedChronologyEventDraft,
  candidate: ChronologyCollapseInputFact,
) {
  const fact = candidate.fact;

  if (existing.date !== fact.date) {
    return false;
  }

  const summarySimilarity = jaccardSimilarity(tokens(existing.summary), tokens(fact.summary));
  if (summarySimilarity >= 0.86) {
    return true;
  }

  const sourceSimilarity = Math.max(
    jaccardSimilarity(tokens(existing.summary), tokens(fact.sourceQuote)),
    jaccardSimilarity(
      tokens(existing.sources.map((source) => source.sourceQuote).join(" ")),
      tokens(fact.summary),
    ),
  );

  return (
    Boolean(fact.date) &&
    summarySimilarity >= 0.45 &&
    sourceSimilarity >= 0.35 &&
    peopleOverlap(existing.people, fact.people)
  );
}

function mergeEvent(
  existing: CollapsedChronologyEventDraft,
  candidate: ChronologyCollapseInputFact,
): CollapsedChronologyEventDraft {
  const candidateFact = candidate.fact;
  const confidence =
    CONFIDENCE_RANK[candidateFact.confidence] < CONFIDENCE_RANK[existing.confidence]
      ? candidateFact.confidence
      : existing.confidence;

  return {
    ...existing,
    confidence,
    organizations: uniqueStrings([
      ...existing.organizations,
      ...candidateFact.organizations,
    ]),
    people: uniqueStrings([...existing.people, ...candidateFact.people]),
    sourceFactIds: [...existing.sourceFactIds, candidate.id],
    sources: [...existing.sources, sourceFromFact(candidate)],
  };
}

export function collapseChronologyFacts(
  facts: ChronologyCollapseInputFact[],
): CollapsedChronologyEventDraft[] {
  const events: CollapsedChronologyEventDraft[] = [];

  for (const fact of facts) {
    const existingIndex = events.findIndex((event) => shouldCollapse(event, fact));

    if (existingIndex >= 0) {
      events[existingIndex] = mergeEvent(events[existingIndex], fact);
      continue;
    }

    events.push(eventDraftFromFacts([fact]));
  }

  return events
    .filter((event) => event.sources.length > 0)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}
