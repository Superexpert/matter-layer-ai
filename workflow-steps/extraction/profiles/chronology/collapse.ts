import type {
  ChronologyCollapseInputFact,
  ChronologySource,
  CollapsedChronologyEventDraft,
} from "./chronology-types";
import type { ChronologyFact } from "./schema";

const CONFIDENCE_RANK = {
  high: 3,
  medium: 2,
  low: 1,
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

function actorOverlap(left: string[], right: string[]) {
  const leftActors = new Set(left.map(normalizedText).filter(Boolean));
  const rightActors = new Set(right.map(normalizedText).filter(Boolean));

  if (leftActors.size === 0 || rightActors.size === 0) {
    return false;
  }

  return [...leftActors].some((actor) => rightActors.has(actor));
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
  return facts.reduce<"high" | "medium" | "low">((lowestConfidence, fact) => {
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

function sortKeyForFact(fact: ChronologyFact) {
  if ("date" in fact && fact.date) {
    return fact.date;
  }

  if ("dateText" in fact && fact.dateText) {
    return `9999-99-99:${fact.dateText}`;
  }

  return "9999-99-99:undated";
}

function eventDraftFromFacts(facts: ChronologyCollapseInputFact[]): CollapsedChronologyEventDraft {
  const primaryFact = facts[0].fact;
  const sourceFacts = facts.map((fact) => fact.fact);
  const actors = uniqueStrings(sourceFacts.flatMap((fact) => ("actors" in fact ? fact.actors : [])));
  let summary: string;

  if ("eventSummary" in primaryFact) {
    summary = primaryFact.eventSummary;
  } else if (primaryFact.factType === "document_date") {
    summary = `${primaryFact.dateRole.replace(/_/g, " ")}: ${primaryFact.sourceFileName}`;
  } else {
    throw new Error(`Unsupported chronology event fact type: ${primaryFact.factType}`);
  }

  return {
    actors,
    confidence: confidenceForFacts(sourceFacts),
    date: "date" in primaryFact ? primaryFact.date : null,
    dateText: "dateText" in primaryFact ? primaryFact.dateText : null,
    isApproximateDate:
      "isApproximateDate" in primaryFact ? primaryFact.isApproximateDate : false,
    sortKey: sortKeyForFact(primaryFact),
    sourceFactIds: facts.map((fact) => fact.id),
    sources: facts.map(sourceFromFact),
    summary,
    title: titleForSummary(summary),
  };
}

function canIncludeDocumentDate(fact: ChronologyFact) {
  return (
    fact.factType === "document_date" &&
    fact.dateRole !== "document_date" &&
    Boolean(fact.date || fact.dateText)
  );
}

function candidateEventFacts(facts: ChronologyCollapseInputFact[]) {
  return facts.filter(({ fact }) => {
    if (fact.factType === "dated_event" || fact.factType === "undated_event") {
      return true;
    }

    return canIncludeDocumentDate(fact);
  });
}

function shouldCollapseDated(
  existing: CollapsedChronologyEventDraft,
  candidate: ChronologyCollapseInputFact,
) {
  const fact = candidate.fact;
  if (fact.factType !== "dated_event" || existing.date !== fact.date) {
    return false;
  }

  const summarySimilarity = jaccardSimilarity(tokens(existing.summary), tokens(fact.eventSummary));
  if (summarySimilarity >= 0.72) {
    return true;
  }

  const sourceSimilarity = Math.max(
    jaccardSimilarity(tokens(existing.summary), tokens(fact.sourceQuote)),
    jaccardSimilarity(tokens(existing.sources.map((source) => source.sourceQuote).join(" ")), tokens(fact.eventSummary)),
  );

  return summarySimilarity >= 0.45 && sourceSimilarity >= 0.35 && actorOverlap(existing.actors, fact.actors);
}

function shouldCollapseUndated(
  existing: CollapsedChronologyEventDraft,
  candidate: ChronologyCollapseInputFact,
) {
  const fact = candidate.fact;
  if (fact.factType !== "undated_event" || existing.date !== null) {
    return false;
  }

  return jaccardSimilarity(tokens(existing.summary), tokens(fact.eventSummary)) >= 0.86;
}

function mergeEvent(
  existing: CollapsedChronologyEventDraft,
  candidate: ChronologyCollapseInputFact,
): CollapsedChronologyEventDraft {
  const mergedFacts = [...existing.sourceFactIds, candidate.id];
  const candidateFact = candidate.fact;
  const candidateActors = "actors" in candidateFact ? candidateFact.actors : [];
  const confidence =
    CONFIDENCE_RANK[candidateFact.confidence] < CONFIDENCE_RANK[existing.confidence]
      ? candidateFact.confidence
      : existing.confidence;

  return {
    ...existing,
    actors: uniqueStrings([...existing.actors, ...candidateActors]),
    confidence,
    sourceFactIds: mergedFacts,
    sources: [...existing.sources, sourceFromFact(candidate)],
  };
}

export function collapseChronologyFacts(
  facts: ChronologyCollapseInputFact[],
): CollapsedChronologyEventDraft[] {
  const events: CollapsedChronologyEventDraft[] = [];

  for (const fact of candidateEventFacts(facts)) {
    const existingIndex = events.findIndex((event) =>
      shouldCollapseDated(event, fact) || shouldCollapseUndated(event, fact),
    );

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
