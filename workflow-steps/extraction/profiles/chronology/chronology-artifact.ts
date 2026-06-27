import type {
  ChronologySource,
  CollapsedChronologyEventDraft,
} from "./chronology-types";

function contiguousRanges(pages: number[]) {
  const sortedPages = [...new Set(pages)].sort((left, right) => left - right);
  const ranges: Array<{ end: number; start: number }> = [];

  for (const page of sortedPages) {
    const lastRange = ranges.at(-1);
    if (lastRange && page === lastRange.end + 1) {
      lastRange.end = page;
      continue;
    }

    ranges.push({
      end: page,
      start: page,
    });
  }

  return ranges;
}

export function formatSourcePages(pages: number[]) {
  if (pages.length === 0) {
    return "";
  }

  const ranges = contiguousRanges(pages);

  if (ranges.length === 1 && ranges[0].start === ranges[0].end) {
    return `p. ${ranges[0].start}`;
  }

  return `pp. ${ranges
    .map((range) =>
      range.start === range.end ? String(range.start) : `${range.start}-${range.end}`,
    )
    .join(", ")}`;
}

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
    "Sources:",
    "",
    ...event.sources.map((source) => `* ${formatSource(source)}`),
  ];

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
