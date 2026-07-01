import { extractModelOutputItems } from "../../json-output";
import type { ExtractionWarning } from "../../types";

export const CHRONOLOGY_FACT_TYPES = ["chronology_fact"] as const;

export const CHRONOLOGY_CONFIDENCE_VALUES = [
  "high",
  "medium",
  "low",
  "unknown",
] as const;

const CONFIDENCE_ALIASES: Record<string, ChronologyConfidence> = {
  certain: "high",
  high: "high",
  missing: "unknown",
  moderate: "medium",
  medium: "medium",
  strong: "high",
  uncertain: "low",
  unknown: "unknown",
  weak: "low",
};

const MONTH_NUMBERS: Record<string, number> = {
  apr: 4,
  april: 4,
  aug: 8,
  august: 8,
  dec: 12,
  december: 12,
  feb: 2,
  february: 2,
  jan: 1,
  january: 1,
  jul: 7,
  july: 7,
  jun: 6,
  june: 6,
  mar: 3,
  march: 3,
  may: 5,
  nov: 11,
  november: 11,
  oct: 10,
  october: 10,
  sep: 9,
  sept: 9,
  september: 9,
};

export type ChronologyFactType = (typeof CHRONOLOGY_FACT_TYPES)[number];
export type ChronologyConfidence = (typeof CHRONOLOGY_CONFIDENCE_VALUES)[number];

export type ChronologyExtractionWarning = ExtractionWarning;

export type RawChronologyFact = {
  id?: string;
  date: string | null;
  dateText: string | null;
  timeText?: string | null;
  sortDate?: string | null;
  isApproximateDate?: boolean | null;
  summary: string;
  people: string[];
  organizations: string[];
  sourceDocumentId: string;
  sourceFileName: string;
  sourcePages: number[];
  sourceQuote: string;
  confidence: ChronologyConfidence;
  labels?: string[];
  notes?: string | null;
  raw?: unknown;
  warnings?: ChronologyExtractionWarning[];
};

export type ChronologyFact = RawChronologyFact & {
  factType: "chronology_fact";
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function warning(input: Omit<ChronologyExtractionWarning, "severity"> & {
  severity?: ChronologyExtractionWarning["severity"];
}): ChronologyExtractionWarning {
  return {
    severity: input.severity ?? "warning",
    ...input,
  };
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Chronology fact ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function optionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue || null;
}

function normalizeStringKey(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
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

function normalizeFullDate(value: string) {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) {
    return formatDateParts(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const numericMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (numericMatch) {
    return formatDateParts(
      Number(numericMatch[3]),
      Number(numericMatch[1]),
      Number(numericMatch[2]),
    );
  }

  const monthNameMatch =
    /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})$/.exec(value);
  if (monthNameMatch) {
    const month = MONTH_NUMBERS[monthNameMatch[1].toLowerCase()];
    if (!month) {
      return null;
    }

    return formatDateParts(
      Number(monthNameMatch[3]),
      month,
      Number(monthNameMatch[2]),
    );
  }

  const approximateMonthMatch =
    /^(?:early|mid|late)\s+([A-Za-z]+)\.?\s+(\d{4})$/i.exec(value);
  if (approximateMonthMatch) {
    const month = MONTH_NUMBERS[approximateMonthMatch[1].toLowerCase()];
    if (!month) {
      return null;
    }

    return formatDateParts(Number(approximateMonthMatch[2]), month, 1);
  }

  return null;
}

function normalizeDate(input: {
  date: unknown;
  dateText: unknown;
  warnings: ChronologyExtractionWarning[];
}) {
  const rawDate = optionalString(input.date);
  const rawDateText = optionalString(input.dateText);
  const candidate = rawDate ?? rawDateText;

  if (!candidate) {
    return {
      date: null,
      dateText: rawDateText,
      sortDate: null,
    };
  }

  const normalizedDate = normalizeFullDate(candidate);

  if (!normalizedDate) {
    input.warnings.push(
      warning({
        code: "unresolved_date",
        message: `Date "${candidate}" could not be normalized and was kept as date text.`,
        rawValue: candidate,
      }),
    );

    return {
      date: null,
      dateText: rawDateText ?? rawDate,
      sortDate: null,
    };
  }

  if (normalizedDate !== candidate) {
    input.warnings.push(
      warning({
        code: "normalized_date",
        message: `Date "${candidate}" was normalized to ${normalizedDate}.`,
        rawValue: candidate,
        severity: "info",
      }),
    );
  }

  return {
    date: normalizedDate,
    dateText: rawDateText ?? rawDate ?? normalizedDate,
    sortDate: normalizedDate,
  };
}

function parsePageValue(value: unknown): number[] | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return [value];
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  const singlePageMatch = /^p(?:age)?\.?\s*(\d+)$/i.exec(trimmedValue) ?? /^(\d+)$/.exec(trimmedValue);
  if (singlePageMatch) {
    return [Number(singlePageMatch[1])];
  }

  const rangeMatch = /^p(?:ages)?\.?\s*(\d+)\s*[-–]\s*(\d+)$/i.exec(trimmedValue) ?? /^(\d+)\s*[-–]\s*(\d+)$/.exec(trimmedValue);
  if (rangeMatch) {
    const startPage = Number(rangeMatch[1]);
    const endPage = Number(rangeMatch[2]);
    if (startPage < 1 || endPage < startPage) {
      return null;
    }

    return Array.from(
      { length: endPage - startPage + 1 },
      (_unused, index) => startPage + index,
    );
  }

  const listMatch = /^p(?:ages)?\.?\s*(\d+(?:\s*,\s*\d+)+)$/i.exec(trimmedValue);
  const listValue = listMatch?.[1] ?? trimmedValue;
  if (/^\d+(?:\s*,\s*\d+)+$/.test(listValue)) {
    return listValue.split(",").map((page) => Number(page.trim()));
  }

  return null;
}

function coercePageArray(
  value: unknown,
  warnings: ChronologyExtractionWarning[],
): number[] {
  if (value === null || value === undefined) {
    throw new Error("Chronology fact sourcePages are required for provenance.");
  }

  const parsedPages = Array.isArray(value)
    ? value.map(parsePageValue)
    : [parsePageValue(value)];

  if (parsedPages.some((pages) => !pages)) {
    throw new Error("Chronology fact sourcePages must identify positive page numbers.");
  }

  const pages = parsedPages.flatMap((item) => item ?? []);
  if (
    pages.length === 0 ||
    pages.some((item) => !Number.isInteger(item) || item < 1)
  ) {
    throw new Error("Chronology fact sourcePages must identify positive page numbers.");
  }

  const uniquePages = [...new Set(pages)];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    warnings.push(
      warning({
        code: "normalized_source_pages",
        message: "sourcePages were normalized to an array of positive page numbers.",
        rawValue: value,
        severity: "info",
      }),
    );
  }

  return uniquePages;
}

function coerceStringArray(
  value: unknown,
  fieldName: string,
  warnings: ChronologyExtractionWarning[],
) {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return [];
    }

    warnings.push(
      warning({
        code: `coerced_${fieldName}`,
        message: `${fieldName} string was converted to a single-item array.`,
        rawValue: value,
        severity: "info",
      }),
    );
    return [trimmedValue];
  }

  if (!Array.isArray(value)) {
    warnings.push(
      warning({
        code: `ignored_${fieldName}`,
        message: `${fieldName} was not a string or array and was ignored.`,
        rawValue: value,
      }),
    );
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function splitSimpleSlashLabels(value: string | null) {
  if (!value) {
    return [];
  }

  if (!value.includes("/")) {
    return [value];
  }

  return value.split("/").map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeConfidence(
  value: unknown,
  warnings: ChronologyExtractionWarning[],
): ChronologyConfidence {
  const stringValue = optionalString(value);

  if (!stringValue) {
    return "unknown";
  }

  const alias = CONFIDENCE_ALIASES[normalizeStringKey(stringValue)];

  if (!alias) {
    warnings.push(
      warning({
        code: "normalized_unknown_confidence",
        message: `Confidence "${stringValue}" was preserved as unknown.`,
        rawValue: stringValue,
      }),
    );
    return "unknown";
  }

  if (alias !== stringValue) {
    warnings.push(
      warning({
        code: "normalized_confidence",
        message: `Confidence "${stringValue}" was normalized to ${alias}.`,
        rawValue: stringValue,
        severity: "info",
      }),
    );
  }

  return alias;
}

function summaryForFact(value: Record<string, unknown>) {
  const summary =
    optionalString(value.summary) ??
    optionalString(value.eventSummary) ??
    optionalString(value.text);

  if (summary) {
    return summary;
  }

  const rawFactType = optionalString(value.factType);
  const dateRole = optionalString(value.dateRole);
  const dateText = optionalString(value.dateText) ?? optionalString(value.date);

  if (rawFactType === "document_date" && dateText) {
    return `The document records ${dateRole ? `${dateRole.replace(/_/g, " ")} ` : "a date "}${dateText}.`;
  }

  throw new Error("Chronology fact summary must be a non-empty string.");
}

function isStandaloneEntityFact(value: Record<string, unknown>) {
  const rawFactType = optionalString(value.factType);
  const hasSummary =
    Boolean(optionalString(value.summary)) ||
    Boolean(optionalString(value.eventSummary)) ||
    Boolean(optionalString(value.text));

  return (
    !hasSummary &&
    (rawFactType === "person" ||
      rawFactType === "organization" ||
      (Boolean(optionalString(value.name)) &&
        (value.role !== undefined || value.organizationType !== undefined)))
  );
}

function labelsForFact(
  value: Record<string, unknown>,
  warnings: ChronologyExtractionWarning[],
) {
  const role = optionalString(value.role);
  const dateRole = optionalString(value.dateRole);
  const organizationType = optionalString(value.organizationType);
  const roleLabels = splitSimpleSlashLabels(role);
  const labels = uniqueStrings([
    ...coerceStringArray(value.labels, "labels", warnings),
    ...roleLabels,
    ...(dateRole ? [dateRole] : []),
    ...(organizationType ? [organizationType] : []),
  ]);

  if (role && roleLabels.length > 1) {
    warnings.push(
      warning({
        code: "normalized_open_role",
        message: `Role "${role}" was preserved and split into labels: ${roleLabels.join(", ")}.`,
        rawValue: role,
      }),
    );
  } else if (role) {
    warnings.push(
      warning({
        code: "preserved_open_role",
        message: `Role "${role}" was preserved as a label instead of rejected.`,
        rawValue: role,
      }),
    );
  }

  if (dateRole) {
    warnings.push(
      warning({
        code: "preserved_open_date_role",
        message: `Date role "${dateRole}" was preserved as a label instead of rejected.`,
        rawValue: dateRole,
      }),
    );
  }

  if (organizationType) {
    warnings.push(
      warning({
        code: "preserved_open_organization_type",
        message: `Organization type "${organizationType}" was preserved as a label instead of rejected.`,
        rawValue: organizationType,
      }),
    );
  }

  return labels;
}

export function chronologyFactSortKey(fact: Pick<ChronologyFact, "sortDate" | "dateText" | "summary">) {
  if (fact.sortDate) {
    return fact.sortDate;
  }

  if (fact.dateText) {
    return `9999-99-98:${fact.dateText}`;
  }

  return `9999-99-99:${fact.summary}`;
}

export function sortChronologyFacts<T extends Pick<ChronologyFact, "sortDate" | "dateText" | "summary">>(
  facts: T[],
) {
  return [...facts].sort((left, right) =>
    chronologyFactSortKey(left).localeCompare(chronologyFactSortKey(right)),
  );
}

export function validateChronologyFact(value: unknown): ChronologyFact {
  if (!isObjectRecord(value)) {
    throw new Error("Chronology fact must be an object.");
  }

  if (isStandaloneEntityFact(value)) {
    throw new Error("Standalone person or organization facts are not chronology rows.");
  }

  const warnings: ChronologyExtractionWarning[] = [];
  const rawFactType = optionalString(value.factType);
  const summary = summaryForFact(value);
  const dateParts = normalizeDate({
    date: value.date,
    dateText: value.dateText,
    warnings,
  });
  const people = coerceStringArray(value.people ?? value.actors, "people", warnings);
  const aliases = coerceStringArray(value.aliases, "aliases", warnings);
  const organizations = coerceStringArray(
    value.organizations,
    "organizations",
    warnings,
  );
  const labels = labelsForFact(value, warnings);

  if (aliases.length > 0) {
    warnings.push(
      warning({
        code: "preserved_aliases_as_labels",
        message: "aliases were preserved as labels because extraction now stores chronology rows, not entity records.",
        rawValue: value.aliases,
        severity: "info",
      }),
    );
  }

  if (rawFactType && rawFactType !== "chronology_fact") {
    warnings.push(
      warning({
        code: "mapped_legacy_fact_type",
        message: `Legacy factType "${rawFactType}" was mapped to a chronology fact.`,
        rawValue: rawFactType,
        severity: "info",
      }),
    );
  }

  return {
    confidence: normalizeConfidence(value.confidence, warnings),
    date: dateParts.date,
    dateText: dateParts.dateText,
    factType: "chronology_fact",
    id: optionalString(value.id) ?? undefined,
    isApproximateDate:
      typeof value.isApproximateDate === "boolean"
        ? value.isApproximateDate
        : Boolean(dateParts.dateText && dateParts.dateText !== dateParts.date),
    labels: uniqueStrings([...labels, ...aliases]),
    notes: optionalString(value.notes),
    organizations,
    people,
    raw: value.raw ?? value,
    sortDate: dateParts.sortDate,
    sourceDocumentId: requireString(value.sourceDocumentId, "sourceDocumentId"),
    sourceFileName: requireString(value.sourceFileName, "sourceFileName"),
    sourcePages: coercePageArray(value.sourcePages, warnings),
    sourceQuote: requireString(value.sourceQuote, "sourceQuote"),
    summary,
    timeText: optionalString(value.timeText),
    warnings,
  };
}

export function parseChronologyExtractionOutput(
  value: string,
  defaults: {
    sourceDocumentId?: string;
    sourceFileName?: string;
    sourcePages?: number[];
  } = {},
) {
  const parsed = extractModelOutputItems({
    content: value,
    itemKeys: ["facts", "chronologyFacts"],
  });

  const facts: ChronologyFact[] = [];
  const rejectedFacts: ChronologyExtractionWarning[] = [];

  parsed.items.forEach((fact, index) => {
    try {
      const factWithDefaults = isObjectRecord(fact)
        ? {
            sourceDocumentId: defaults.sourceDocumentId,
            sourceFileName: defaults.sourceFileName,
            ...fact,
            raw: fact,
            sourcePages:
              Array.isArray(fact.sourcePages) && fact.sourcePages.length === 0
                ? defaults.sourcePages
                : fact.sourcePages ?? defaults.sourcePages,
          }
        : fact;

      facts.push(validateChronologyFact(factWithDefaults));
    } catch (error) {
      rejectedFacts.push({
        code: "rejected_unusable_fact",
        factId: isObjectRecord(fact) && typeof fact.id === "string" ? fact.id : undefined,
        message: error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Chronology fact was rejected because it was unusable.",
        rawValue: fact,
        severity: "error",
      });

      if (isObjectRecord(fact) && isStandaloneEntityFact(fact)) {
        rejectedFacts[rejectedFacts.length - 1].message =
          `Ignored standalone entity fact at index ${index}; chronology extraction only keeps sourced events.`;
      }
    }
  });

  if (facts.length === 0 && parsed.items.length > 0) {
    throw new Error(
      `No usable chronology facts were extracted. ${rejectedFacts[0]?.message ?? ""}`.trim(),
    );
  }

  return {
    facts: sortChronologyFacts(facts),
    warnings: [
      ...facts.flatMap((fact) => fact.warnings ?? []),
      ...rejectedFacts,
    ],
  };
}

export function countFactsByType(facts: ChronologyFact[]) {
  return facts.reduce<Record<string, number>>(
    (counts, fact) => ({
      ...counts,
      [fact.factType]: (counts[fact.factType] ?? 0) + 1,
    }),
    {
      chronology_fact: 0,
    },
  );
}
