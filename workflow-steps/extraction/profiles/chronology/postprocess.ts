import { generateChronologyMarkdown } from "./chronology-artifact";
import { collapseChronologyFacts } from "./collapse";
import { sortChronologyFacts, type ChronologyFact } from "./schema";

export type ChronologyFactOutput = ChronologyFact & {
  id: string;
};

export type ChronologyCollapsedEventOutput = ReturnType<typeof collapseChronologyFacts>[number] & {
  id: string;
};

export type ChronologyPostprocessResult = {
  artifactMarkdown: string | null;
  collapsedEventCount: number;
  datedCollapsedEventCount: number;
  events: ChronologyCollapsedEventOutput[];
  facts: ChronologyFactOutput[];
  generatedFromFactCount: number;
  undatedCollapsedEventCount: number;
};

export function chronologyFactId(index: number) {
  return `fact_${String(index + 1).padStart(4, "0")}`;
}

export function chronologyEventId(index: number) {
  return `event_${String(index + 1).padStart(4, "0")}`;
}

export function buildChronologyPostprocessResult(
  facts: ChronologyFact[],
): ChronologyPostprocessResult {
  const sortedFacts = sortChronologyFacts(facts);
  const factsWithIds = sortedFacts.map((fact, index) => ({
    ...fact,
    id: chronologyFactId(index),
  }));
  const collapsedEvents = collapseChronologyFacts(
    factsWithIds.map(({ id, ...fact }) => ({
      fact,
      id,
    })),
  );
  const events = collapsedEvents.map((event, index) => ({
    ...event,
    id: chronologyEventId(index),
  }));
  const datedCollapsedEventCount = events.filter((event) => event.date).length;

  return {
    artifactMarkdown: events.length > 0 ? generateChronologyMarkdown(events) : null,
    collapsedEventCount: events.length,
    datedCollapsedEventCount,
    events,
    facts: factsWithIds,
    generatedFromFactCount: factsWithIds.length,
    undatedCollapsedEventCount: events.length - datedCollapsedEventCount,
  };
}
