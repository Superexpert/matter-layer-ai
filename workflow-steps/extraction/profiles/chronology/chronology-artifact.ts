import type {
  ChronologySource,
  CollapsedChronologyEventDraft,
} from "./chronology-types";
import { formatSourcePages } from "../../source-format";

export { formatSourcePages };

const DOCUMENT_TYPE_SUFFIXES = [
  "Supplemental Report",
] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MONTH_NUMBERS: Record<string, number> = Object.fromEntries(
  MONTH_NAMES.map((month, index) => [month.toLowerCase(), index + 1]),
);
const BACKGROUND_PATTERNS = [
  /\bdate of birth\b/i,
  /\bDOB\b/i,
  /^\s*People\s*:/i,
  /^\s*Organizations?\s*:/i,
];

function titleCaseDocumentName(value: string) {
  return value
    .split(" ")
    .map((word) => {
      if (/^[A-Z0-9]+$/.test(word)) {
        return word;
      }

      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function readableSourceTitle(sourceFileName: string) {
  const withoutExtension = sourceFileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .replace(/^\d+[\s_-]+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = titleCaseDocumentName(normalized);

  for (const suffix of DOCUMENT_TYPE_SUFFIXES) {
    const suffixPrefix = `${suffix} Officer `;
    if (title.startsWith(suffixPrefix)) {
      return `Officer ${title.slice(suffixPrefix.length)} ${suffix}`;
    }
  }

  return title;
}

function formatSource(source: ChronologySource) {
  const pages = formatSourcePages(source.sourcePages);
  const title = readableSourceTitle(source.sourceFileName);

  return pages ? `${title}, ${pages}` : title;
}

function formatDisplayDate(date: string) {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateParts) {
    throw new Error(`Chronology event date must be YYYY-MM-DD: ${date}`);
  }

  const month = MONTH_NAMES[Number(dateParts[2]) - 1];
  const day = Number(dateParts[3]);
  const year = Number(dateParts[1]);

  if (!month || day < 1 || day > 31) {
    throw new Error(`Chronology event date is invalid: ${date}`);
  }

  return `${month} ${day}, ${year}`;
}

function formatDateParts(year: number, month: number, day: number) {
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function ensureSentence(value: string) {
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

function sourceLineForEvent(event: CollapsedChronologyEventDraft) {
  const sources = [...new Set(event.sources.map(formatSource))];

  return ensureSentence(`Source: ${sources.join("; ")}`);
}

function inferredDateFromText(value: string) {
  const cleanedValue = value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:null|undefined|none|n\/a)$/i.test(part))
    .join(" ");
  const numericDateMatch =
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}\s*[AP]\.?M\.?)?\b/i.exec(
      cleanedValue,
    );
  if (numericDateMatch) {
    return formatDateParts(
      Number(numericDateMatch[3]),
      Number(numericDateMatch[1]),
      Number(numericDateMatch[2]),
    );
  }

  const monthNamePattern = MONTH_NAMES.join("|");
  const match = new RegExp(
    `\\b(${monthNamePattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b`,
    "i",
  ).exec(cleanedValue);
  if (!match) {
    return null;
  }

  const month = MONTH_NUMBERS[match[1].toLowerCase()];
  if (!month) {
    return null;
  }

  return formatDateParts(Number(match[3]), month, Number(match[2]));
}

function eventDate(event: CollapsedChronologyEventDraft) {
  return event.date ?? inferredDateFromText([
    event.dateText,
    event.summary,
    ...event.sources.map((source) => source.sourceQuote),
  ].filter(Boolean).join(" "));
}

function timeSortKeyFromText(value: string | null) {
  if (!value) {
    return null;
  }
  const cleanedValue = value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:null|undefined|none|n\/a)$/i.test(part))
    .join(" ");

  const meridiemMatch = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(cleanedValue);
  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1]);
    const minute = Number(meridiemMatch[2] ?? "0");
    const meridiem = meridiemMatch[3].toLowerCase();

    if (hour < 1 || hour > 12 || minute > 59) {
      return null;
    }

    if (meridiem === "p" && hour !== 12) {
      hour += 12;
    } else if (meridiem === "a" && hour === 12) {
      hour = 0;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const hourMinuteMatch = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(cleanedValue);
  if (hourMinuteMatch) {
    return `${hourMinuteMatch[1].padStart(2, "0")}:${hourMinuteMatch[2]}`;
  }

  const militaryHoursMatch = /\b(?:at\s+)?([01]\d|2[0-3])([0-5]\d)\s*hours\b/i.exec(cleanedValue);
  if (militaryHoursMatch) {
    return `${militaryHoursMatch[1]}:${militaryHoursMatch[2]}`;
  }

  return null;
}

function timeSortKeyForEvent(event: CollapsedChronologyEventDraft) {
  return timeSortKeyFromText(event.timeText) ?? timeSortKeyFromText(event.summary);
}

function formattedTimeFromSortKey(sortKey: string) {
  const [hourValue, minuteValue] = sortKey.split(":").map(Number);
  const meridiem = hourValue >= 12 ? "p.m." : "a.m.";
  const hour = hourValue % 12 || 12;

  return `${hour}:${String(minuteValue).padStart(2, "0")} ${meridiem}`;
}

function summaryWithoutGroupedDate(summary: string, date: string | null) {
  let cleaned = summary.trim();

  if (date) {
    const displayDate = formatDisplayDate(date);
    const escapedDisplayDate = displayDate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned
      .replace(new RegExp(`\\s+on\\s+${escapedDisplayDate}(?=\\s*(?:and\\b|[,.;]|$))`, "i"), "")
      .replace(new RegExp(`\\s+on\\s+${escapedDisplayDate}\\b`, "i"), "")
      .replace(new RegExp(`\\s+${escapedDisplayDate}(?=\\s*(?:and\\b|[,.;]|$))`, "i"), "");
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

function normalizeChronologySentence(event: CollapsedChronologyEventDraft, date: string | null) {
  const timeSortKey = timeSortKeyForEvent(event);
  let summary = summaryWithoutGroupedDate(event.summary, date);

  if (timeSortKey) {
    const time = formattedTimeFromSortKey(timeSortKey);
    if (/\bat\s+\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b/i.test(summary)) {
      summary = summary.replace(
        /\bat\s+\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b/i,
        `at ${time}`,
      );
    } else if (/\bat\s+([01]\d|2[0-3])([0-5]\d)\s*hours\b/i.test(summary)) {
      summary = summary.replace(
        /\bat\s+([01]\d|2[0-3])([0-5]\d)\s*hours\b/i,
        `at ${time}`,
      );
    } else {
      summary = summary.replace(/\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b/i, `at ${time}`);
    }
  }

  summary = summary.replace(/\b([ap]\.m\.)\./gi, "$1");

  return ensureSentence(summary);
}

function markdownForEvent(event: CollapsedChronologyEventDraft, date: string | null) {
  return [
    normalizeChronologySentence(event, date),
    "",
    sourceLineForEvent(event),
  ].join("\n");
}

function isRenderableChronologyEvent(event: CollapsedChronologyEventDraft) {
  if (event.sources.length === 0) {
    return false;
  }

  return !BACKGROUND_PATTERNS.some((pattern) => pattern.test(event.summary));
}

export function generateChronologyMarkdown(events: CollapsedChronologyEventDraft[]) {
  const sortedEvents = events
    .filter(isRenderableChronologyEvent)
    .map((event, index) => ({
      date: eventDate(event),
      event,
      index,
      timeSortKey: timeSortKeyForEvent(event),
    }))
    .sort((left, right) => {
      if (left.date && right.date && left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }
      if (left.date && !right.date) {
        return -1;
      }
      if (!left.date && right.date) {
        return 1;
      }
      if (left.timeSortKey && right.timeSortKey && left.timeSortKey !== right.timeSortKey) {
        return left.timeSortKey.localeCompare(right.timeSortKey);
      }
      if (left.timeSortKey && !right.timeSortKey) {
        return -1;
      }
      if (!left.timeSortKey && right.timeSortKey) {
        return 1;
      }

      return left.index - right.index;
    });
  if (sortedEvents.length === 0) {
    throw new Error("Chronology artifact has no renderable events.");
  }

  const lines: string[] = [];
  let currentDate = "";
  let hasUndatedHeading = false;

  for (const item of sortedEvents) {
    if (item.date) {
      if (item.date !== currentDate) {
        currentDate = item.date;
        lines.push(`### ${formatDisplayDate(item.date)}`, "");
      }

      lines.push(markdownForEvent(item.event, item.date), "");
      continue;
    }

    if (!hasUndatedHeading) {
      hasUndatedHeading = true;
      lines.push("### Undated Events", "");
    }

    lines.push(markdownForEvent(item.event, null), "");
  }

  return lines.join("\n").trimEnd();
}
