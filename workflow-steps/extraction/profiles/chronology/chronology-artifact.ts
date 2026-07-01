import type {
  ChronologySource,
  CollapsedChronologyEventDraft,
} from "./chronology-types";
import { formatSourcePages } from "../../source-format";

export { formatSourcePages };

function formatSource(source: ChronologySource) {
  const pages = formatSourcePages(source.sourcePages);

  return pages ? `${source.sourceFileName}, ${pages}` : source.sourceFileName;
}

function formatDisplayDate(event: CollapsedChronologyEventDraft) {
  return event.dateText || event.date || "Undated";
}

function markdownForEvent(event: CollapsedChronologyEventDraft) {
  const lines = [
    `### ${formatDisplayDate(event)}`,
    "",
    `**${event.title}**`,
    "",
    event.summary,
    "",
    event.people.length > 0 ? `People: ${event.people.join(", ")}` : "",
    event.organizations.length > 0
      ? `Organizations: ${event.organizations.join(", ")}`
      : "",
    event.people.length > 0 || event.organizations.length > 0 ? "" : "",
    "Sources:",
    "",
    ...event.sources.map((source) => `* ${formatSource(source)}`),
  ].filter((line, index, allLines) => line || allLines[index - 1]);

  return lines.join("\n");
}

export function generateChronologyMarkdown(events: CollapsedChronologyEventDraft[]) {
  const sourcedEvents = events.filter((event) => event.sources.length > 0);
  const datedEvents = sourcedEvents.filter((event) => event.date);
  const undatedEvents = sourcedEvents.filter((event) => !event.date);
  const lines = [
    "# Chronology",
    "",
    "Generated from selected matter documents.",
    "",
  ];

  if (datedEvents.length > 0) {
    lines.push("## Dated Events", "");
    lines.push(...datedEvents.flatMap((event) => [markdownForEvent(event), ""]));
  }

  if (undatedEvents.length > 0) {
    lines.push("## Undated Events", "");
    lines.push(...undatedEvents.flatMap((event) => [markdownForEvent(event), ""]));
  }

  return lines.join("\n").trimEnd();
}
