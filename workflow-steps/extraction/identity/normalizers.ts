export type NormalizerName =
  | "acreage"
  | "affected-feature"
  | "currency"
  | "date"
  | "description-text"
  | "lowercase"
  | "organization-name"
  | "parcel-number"
  | "postal-address"
  | "project-name"
  | "trim";

export type NormalizedFactField = {
  canonicalValue?: unknown;
  normalizedValue: unknown;
  originalValue: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function lowercase(value: unknown) {
  const trimmed = stringValue(value);

  return typeof trimmed === "string"
    ? collapseWhitespace(trimmed).toLowerCase()
    : trimmed;
}

function punctuationToSpaces(value: string) {
  return value.replace(/[.,;:()[\]{}'"`]/g, " ");
}

function normalizeEntityName(value: unknown) {
  const lowered = lowercase(value);

  if (typeof lowered !== "string") {
    return lowered;
  }

  return collapseWhitespace(
    punctuationToSpaces(lowered)
      .replace(/\bl\s*l\s*c\b/g, "llc")
      .replace(/\bl\s*l\s*p\b/g, "llp")
      .replace(/\bl\s*p\b/g, "lp")
      .replace(/\bincorporated\b/g, "inc")
      .replace(/\bcorporation\b/g, "corp"),
  );
}

function normalizeParcelNumber(value: unknown) {
  const lowered = lowercase(value);

  if (typeof lowered !== "string") {
    return lowered;
  }

  const normalized = collapseWhitespace(
    punctuationToSpaces(lowered)
      .replace(/\bparcel\s+(?:no|number)\b/g, "parcel")
      .replace(/\bparcel\s*#\s*/g, "parcel ")
      .replace(/^#\s*/, ""),
  );
  const parcelMatch = /^parcel\s+(.+)$/.exec(normalized);
  const valueOnlyMatch = /^[a-z0-9][a-z0-9 -]*$/i.test(normalized);

  if (parcelMatch?.[1]) {
    return `parcel:${collapseWhitespace(parcelMatch[1])}`;
  }

  if (valueOnlyMatch) {
    return `parcel:${normalized}`;
  }

  return normalized;
}

function canonicalParcelNumber(normalizedValue: unknown) {
  if (typeof normalizedValue !== "string") {
    return undefined;
  }

  const match = /^parcel:(.+)$/.exec(normalizedValue);

  return match?.[1] ? `Parcel ${match[1]}` : undefined;
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function isoDateForParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

const MONTH_NUMBERS = new Map([
  ["january", 1],
  ["jan", 1],
  ["february", 2],
  ["feb", 2],
  ["march", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["may", 5],
  ["june", 6],
  ["jun", 6],
  ["july", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sep", 9],
  ["sept", 9],
  ["october", 10],
  ["oct", 10],
  ["november", 11],
  ["nov", 11],
  ["december", 12],
  ["dec", 12],
]);

function normalizeEnglishDate(value: string) {
  const match = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,)?\s+(\d{4})$/.exec(value);

  if (!match) {
    return undefined;
  }

  const month = MONTH_NUMBERS.get(match[1]!.toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);

  return month === undefined ? undefined : isoDateForParts(year, month, day);
}

function normalizeDate(value: unknown) {
  const trimmed = stringValue(value);

  if (typeof trimmed !== "string") {
    return trimmed;
  }

  if (isValidIsoDate(trimmed)) {
    return trimmed;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }

  const dateTimePrefix = /^(\d{4}-\d{2}-\d{2})T/.exec(trimmed);

  if (dateTimePrefix?.[1] && isValidIsoDate(dateTimePrefix[1])) {
    return dateTimePrefix[1];
  }

  const englishDate = normalizeEnglishDate(collapseWhitespace(trimmed));

  if (englishDate) {
    return englishDate;
  }

  return undefined;
}

function canonicalCurrencyFromNormalized(value: unknown) {
  if (typeof value !== "string" || !/^-?\d+\.\d{2}$/.test(value)) {
    return undefined;
  }

  const negative = value.startsWith("-");
  const absoluteValue = negative ? value.slice(1) : value;
  const [whole = "0", cents = "00"] = absoluteValue.split(".");
  const formattedWhole = Number(whole).toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    useGrouping: true,
  });
  const formatted = cents === "00"
    ? `$${formattedWhole}`
    : `$${formattedWhole}.${cents}`;

  return negative ? `-${formatted}` : formatted;
}

function normalizeCurrency(value: unknown) {
  const trimmed = stringValue(value);

  if (typeof trimmed !== "string") {
    return typeof trimmed === "number" && Number.isFinite(trimmed)
      ? trimmed.toFixed(2)
      : trimmed;
  }

  const numericText = trimmed.replace(/[$,\s]/g, "");

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(numericText)) {
    return lowercase(trimmed);
  }

  return Number(numericText).toFixed(2);
}

function canonicalAcreageFromNormalized(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = /^acres:(-?\d+(?:\.\d+)?)$/.exec(value);

  if (!match?.[1]) {
    return undefined;
  }

  const acreage = Number(match[1]);

  if (!Number.isFinite(acreage)) {
    return undefined;
  }

  const formatted = acreage.toLocaleString("en-US", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
    useGrouping: false,
  });

  return `${formatted} ${acreage === 1 ? "acre" : "acres"}`;
}

function normalizeAcreage(value: unknown) {
  const trimmed = stringValue(value);

  if (typeof trimmed !== "string") {
    return trimmed;
  }

  const normalized = lowercase(trimmed);
  if (typeof normalized !== "string") {
    return normalized;
  }
  const match = /(?:approximately|approx\.?|about)?\s*(\d+(?:\.\d+)?)\s*(?:acres?|ac\.)\b/.exec(
    normalized,
  );

  if (!match?.[1]) {
    return normalized;
  }

  return `acres:${Number(match[1]).toFixed(4)}`;
}

function normalizePostalAddress(value: unknown) {
  const lowered = lowercase(value);

  if (typeof lowered !== "string") {
    return lowered;
  }

  return collapseWhitespace(
    punctuationToSpaces(lowered)
      .replace(/\bstreet\b/g, "st")
      .replace(/\bavenue\b/g, "ave")
      .replace(/\broad\b/g, "rd")
      .replace(/\blane\b/g, "ln")
      .replace(/\bdrive\b/g, "dr")
      .replace(/\bboulevard\b/g, "blvd")
      .replace(/\bnorth\b/g, "n")
      .replace(/\bsouth\b/g, "s")
      .replace(/\beast\b/g, "e")
      .replace(/\bwest\b/g, "w"),
  );
}

function normalizeAffectedFeature(value: unknown) {
  const lowered = lowercase(value);

  if (typeof lowered !== "string") {
    return lowered;
  }

  const exactAliases = new Map([
    ["western driveway", "west driveway"],
    ["driveway west", "west driveway"],
  ]);

  return exactAliases.get(lowered) ?? lowered;
}

export function normalizeFieldValue(
  value: unknown,
  normalizer: string | undefined,
): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (normalizer as NormalizerName | undefined) {
    case "trim":
      return stringValue(value);
    case "lowercase":
      return lowercase(value);
    case "organization-name":
    case "project-name":
      return normalizeEntityName(value);
    case "parcel-number":
      return normalizeParcelNumber(value);
    case "postal-address":
      return normalizePostalAddress(value);
    case "date":
      return normalizeDate(value);
    case "currency":
      return normalizeCurrency(value);
    case "acreage":
      return normalizeAcreage(value);
    case "affected-feature":
      return normalizeAffectedFeature(value);
    case "description-text":
      return lowercase(value);
    default:
      return typeof value === "string" ? collapseWhitespace(value) : value;
  }
}

function canonicalFieldValue(
  normalizedValue: unknown,
  normalizer: string | undefined,
): unknown {
  switch (normalizer as NormalizerName | undefined) {
    case "date":
      return typeof normalizedValue === "string" ? normalizedValue : undefined;
    case "currency":
      return canonicalCurrencyFromNormalized(normalizedValue);
    case "parcel-number":
      return canonicalParcelNumber(normalizedValue);
    case "acreage":
      return canonicalAcreageFromNormalized(normalizedValue);
    default:
      return undefined;
  }
}

export function normalizedField(
  value: unknown,
  normalizer: string | undefined,
): NormalizedFactField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" && !value.trim()) {
    return undefined;
  }

  const normalizedValue = normalizeFieldValue(value, normalizer);
  const canonicalValue = canonicalFieldValue(normalizedValue, normalizer);

  return {
    ...(canonicalValue === undefined ? {} : { canonicalValue }),
    normalizedValue,
    originalValue: value,
  };
}
