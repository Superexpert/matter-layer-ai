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

function normalizeDate(value: unknown) {
  const trimmed = stringValue(value);

  if (typeof trimmed !== "string") {
    return trimmed;
  }

  if (isValidIsoDate(trimmed)) {
    return trimmed;
  }

  const dateTimePrefix = /^(\d{4}-\d{2}-\d{2})T/.exec(trimmed);

  if (dateTimePrefix?.[1] && isValidIsoDate(dateTimePrefix[1])) {
    return dateTimePrefix[1];
  }

  return collapseWhitespace(trimmed.toLowerCase());
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

  return {
    normalizedValue: normalizeFieldValue(value, normalizer),
    originalValue: value,
  };
}
