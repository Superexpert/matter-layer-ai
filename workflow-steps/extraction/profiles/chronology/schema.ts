export const CHRONOLOGY_FACT_TYPES = [
  "dated_event",
  "undated_event",
  "person",
  "organization",
  "document_date",
] as const;

export const CHRONOLOGY_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

const PERSON_ROLES = [
  "plaintiff",
  "defendant",
  "witness",
  "attorney",
  "judge",
  "officer",
  "doctor",
  "employee",
  "employer",
  "other",
  "unknown",
] as const;

const ORGANIZATION_TYPES = [
  "court",
  "law_firm",
  "law_enforcement",
  "employer",
  "hospital",
  "government_agency",
  "business",
  "other",
  "unknown",
] as const;

const DOCUMENT_DATE_ROLES = [
  "document_date",
  "filing_date",
  "signature_date",
  "email_sent_date",
  "email_received_date",
  "other",
] as const;

const ORGANIZATION_TYPE_ALIASES: Record<string, (typeof ORGANIZATION_TYPES)[number]> = {
  agency: "government_agency",
  business: "business",
  company: "business",
  corporation: "business",
  court: "court",
  "government agency": "government_agency",
  hospital: "hospital",
  "law enforcement": "law_enforcement",
  "law enforcement agency": "law_enforcement",
  "law firm": "law_firm",
  "law office": "law_firm",
  police: "law_enforcement",
  "police department": "law_enforcement",
  sheriff: "law_enforcement",
  "sheriff's office": "law_enforcement",
  unknown: "unknown",
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

type BaseChronologyFact = {
  confidence: ChronologyConfidence;
  factType: ChronologyFactType;
  sourceDocumentId: string;
  sourceFileName: string;
  sourcePages: number[];
  sourceQuote: string;
};

export type ChronologyFact =
  | (BaseChronologyFact & {
      actors: string[];
      date: string | null;
      dateText: string;
      eventSummary: string;
      factType: "dated_event";
      isApproximateDate: boolean;
    })
  | (BaseChronologyFact & {
      actors: string[];
      dateClues: string;
      eventSummary: string;
      factType: "undated_event";
    })
  | (BaseChronologyFact & {
      aliases: string[];
      factType: "person";
      name: string;
      role: (typeof PERSON_ROLES)[number];
    })
  | (BaseChronologyFact & {
      factType: "organization";
      name: string;
      organizationType: (typeof ORGANIZATION_TYPES)[number];
    })
  | (BaseChronologyFact & {
      date: string | null;
      dateRole: (typeof DOCUMENT_DATE_ROLES)[number];
      dateText: string;
      factType: "document_date";
    });

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Chronology fact ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
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

  return null;
}

function requireNullableDate(value: unknown, fieldName: string) {
  if (value === null) {
    return null;
  }

  const date = requireString(value, fieldName);
  const normalizedDate = normalizeFullDate(date);

  if (!normalizedDate) {
    throw new Error(`Chronology fact ${fieldName} must be YYYY-MM-DD or null.`);
  }

  return normalizedDate;
}

function requireBoolean(value: unknown, fieldName: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Chronology fact ${fieldName} must be a boolean.`);
  }

  return value;
}

function requireStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Chronology fact ${fieldName} must be an array of strings.`);
  }

  return value.map((item) => item.trim()).filter(Boolean);
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

function requirePageArray(value: unknown): number[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value) && value.length === 0) {
    return [];
  }

  const parsedPages = Array.isArray(value)
    ? value.map(parsePageValue)
    : [parsePageValue(value)];

  if (parsedPages.some((pages) => !pages)) {
    throw new Error("Chronology fact sourcePages must be an array of positive integers.");
  }

  const pages = parsedPages.flatMap((item) => item ?? []);
  if (pages.some((item) => !Number.isInteger(item) || item < 1)) {
    throw new Error("Chronology fact sourcePages must be an array of positive integers.");
  }

  return [...new Set(pages)];
}

function requireEnum<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  options: T,
): T[number] {
  const stringValue = requireString(value, fieldName);

  if (!options.includes(stringValue)) {
    throw new Error(`Chronology fact ${fieldName} is not supported: ${stringValue}`);
  }

  return stringValue as T[number];
}

function requireConfidence(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return "low";
  }

  return requireEnum(value, "confidence", CHRONOLOGY_CONFIDENCE_VALUES);
}

function requireOrganizationType(value: unknown) {
  const stringValue = requireString(value, "organizationType");
  if (ORGANIZATION_TYPES.includes(stringValue as (typeof ORGANIZATION_TYPES)[number])) {
    return stringValue as (typeof ORGANIZATION_TYPES)[number];
  }

  const normalizedValue = stringValue.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const alias = ORGANIZATION_TYPE_ALIASES[normalizedValue];
  if (!alias) {
    throw new Error(`Chronology fact organizationType is not supported: ${stringValue}`);
  }

  return alias;
}

function normalizeJsonResponseText(value: string) {
  const trimmedValue = value.trim();
  const fencedJsonMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmedValue);

  return fencedJsonMatch ? fencedJsonMatch[1].trim() : trimmedValue;
}

function parseBaseFact(value: Record<string, unknown>, factType: ChronologyFactType) {
  return {
    confidence: requireConfidence(value.confidence),
    factType,
    sourceDocumentId: requireString(value.sourceDocumentId, "sourceDocumentId"),
    sourceFileName: requireString(value.sourceFileName, "sourceFileName"),
    sourcePages: requirePageArray(value.sourcePages),
    sourceQuote: requireString(value.sourceQuote, "sourceQuote"),
  };
}

export function validateChronologyFact(value: unknown): ChronologyFact {
  if (!isObjectRecord(value)) {
    throw new Error("Chronology fact must be an object.");
  }

  const factType = requireEnum(value.factType, "factType", CHRONOLOGY_FACT_TYPES);
  const base = parseBaseFact(value, factType);

  if (factType === "dated_event") {
    return {
      ...base,
      actors: requireStringArray(value.actors, "actors"),
      date: requireNullableDate(value.date, "date"),
      dateText: requireString(value.dateText, "dateText"),
      eventSummary: requireString(value.eventSummary, "eventSummary"),
      factType,
      isApproximateDate: requireBoolean(value.isApproximateDate, "isApproximateDate"),
    };
  }

  if (factType === "undated_event") {
    return {
      ...base,
      actors: requireStringArray(value.actors, "actors"),
      dateClues: typeof value.dateClues === "string" ? value.dateClues.trim() : "",
      eventSummary: requireString(value.eventSummary, "eventSummary"),
      factType,
    };
  }

  if (factType === "person") {
    return {
      ...base,
      aliases: requireStringArray(value.aliases, "aliases"),
      factType,
      name: requireString(value.name, "name"),
      role: requireEnum(value.role, "role", PERSON_ROLES),
    };
  }

  if (factType === "organization") {
    return {
      ...base,
      factType,
      name: requireString(value.name, "name"),
      organizationType: requireOrganizationType(value.organizationType),
    };
  }

  return {
    ...base,
    date: requireNullableDate(value.date, "date"),
    dateRole: requireEnum(value.dateRole, "dateRole", DOCUMENT_DATE_ROLES),
    dateText: requireString(value.dateText, "dateText"),
    factType,
  };
}

export function parseChronologyExtractionOutput(value: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(normalizeJsonResponseText(value));
  } catch {
    throw new Error("Chronology extraction response must be valid JSON.");
  }

  if (!isObjectRecord(parsed) || !Array.isArray(parsed.facts)) {
    throw new Error("Chronology extraction response must include a facts array.");
  }

  return {
    facts: parsed.facts.map(validateChronologyFact),
  };
}

export function countFactsByType(facts: ChronologyFact[]) {
  return facts.reduce<Record<ChronologyFactType, number>>(
    (counts, fact) => ({
      ...counts,
      [fact.factType]: counts[fact.factType] + 1,
    }),
    {
      dated_event: 0,
      document_date: 0,
      organization: 0,
      person: 0,
      undated_event: 0,
    },
  );
}
