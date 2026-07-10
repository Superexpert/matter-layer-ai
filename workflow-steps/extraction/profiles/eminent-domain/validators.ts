function normalizedKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VAGUE_TAKING_VALUES = new Set([
  "taking",
  "proposed taking",
  "disputed taking",
  "eminent domain taking",
  "condemnation",
  "acquisition",
  "property acquisition",
]);

const PROPERTY_INTEREST_FIELD_NAMES = [
  "interestType",
  "takingScope",
  "area",
  "remainderArea",
  "purpose",
  "parcelNumber",
  "address",
  "county",
];

function isVagueTakingValue(value: unknown) {
  return typeof value === "string" && VAGUE_TAKING_VALUES.has(normalizedKey(value));
}

function cleanOptionalStringField(
  fields: Record<string, unknown>,
  fieldName: string,
) {
  if (typeof fields[fieldName] !== "string") {
    return;
  }

  const trimmed = fields[fieldName].trim();

  if (trimmed) {
    fields[fieldName] = trimmed;
  } else {
    delete fields[fieldName];
  }
}

export function validateEminentDomainMatterEntity(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const validatedFields = { ...fields };

  if (validatedFields.entityType !== "condemning-authority") {
    delete validatedFields.department;
  }

  if (validatedFields.entityType !== "project") {
    delete validatedFields.projectNumber;
  }

  return validatedFields;
}

export function validateEminentDomainPropertyInterest(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const interestType = fields.interestType;

  if (typeof interestType !== "string" || !interestType.trim()) {
    throw new Error("PROPERTY_INTEREST facts require a specific interest type.");
  }

  const substantiveEntries = PROPERTY_INTEREST_FIELD_NAMES
    .map((fieldName) => [fieldName, fields[fieldName]] as const)
    .filter((entry): entry is readonly [string, string] =>
      typeof entry[1] === "string" && entry[1].trim().length > 0,
    );

  if (substantiveEntries.length <= 1) {
    throw new Error(
      "PROPERTY_INTEREST facts require at least one stated identifying or substantive field.",
    );
  }

  if (
    interestType === "other" &&
    substantiveEntries.every((entry) =>
      entry[0] === "interestType" || isVagueTakingValue(entry[1]),
    )
  ) {
    throw new Error(
      "PROPERTY_INTEREST classification is too vague.",
    );
  }

  for (const [, value] of substantiveEntries) {
    if (isVagueTakingValue(value)) {
      throw new Error(`PROPERTY_INTEREST value "${value}" is too vague.`);
    }
  }

  return fields;
}

const OFFER_VALUATION_TYPES = new Set(["initial-offer", "final-offer"]);
const APPRAISAL_VALUATION_TYPES = new Set([
  "condemnor-appraisal",
  "owner-appraisal",
]);
const APPRAISAL_ONLY_FIELDS = [
  "appraiser",
  "effectiveDate",
  "reportDate",
  "partTakenValue",
  "remainderDamages",
  "temporaryDamages",
  "costToCure",
];
const OFFER_ONLY_FIELDS = ["offerDate", "responseDeadline"];
const DOCUMENT_DATED_EVENT_TYPES = new Set([
  "appraisal-completed",
  "final-offer-issued",
  "hearing-notice-issued",
  "initial-offer-issued",
  "owner-response",
  "petition-filed",
  "service-completed",
]);

function highConfidenceDocumentDate(window: ExtractionMarkdownWindow) {
  const metadata = window.documentMetadata;

  if (
    metadata?.documentDate &&
    metadata.documentDateConfidence === "high"
  ) {
    return metadata.documentDate;
  }

  return undefined;
}

export function validateEminentDomainEvent(
  fields: Record<string, unknown>,
  context: {
    window: ExtractionMarkdownWindow;
  },
): Record<string, unknown> {
  const validatedFields = { ...fields };

  if (
    !validatedFields.eventDate &&
    typeof validatedFields.eventType === "string" &&
    DOCUMENT_DATED_EVENT_TYPES.has(validatedFields.eventType)
  ) {
    const documentDate = highConfidenceDocumentDate(context.window);

    if (documentDate) {
      validatedFields.eventDate = documentDate;
    }
  }

  return validatedFields;
}

export function validateEminentDomainValuation(
  fields: Record<string, unknown>,
  context: {
    window: ExtractionMarkdownWindow;
  },
): Record<string, unknown> {
  const valuationType = typeof fields.valuationType === "string"
    ? fields.valuationType
    : "";
  const validatedFields = { ...fields };

  if (OFFER_VALUATION_TYPES.has(valuationType)) {
    for (const fieldName of APPRAISAL_ONLY_FIELDS) {
      delete validatedFields[fieldName];
    }

    if (typeof validatedFields.amount !== "string" || !validatedFields.amount.trim()) {
      throw new Error("Offer VALUATION facts require an amount.");
    }

    if (!validatedFields.offerDate) {
      const documentDate = highConfidenceDocumentDate(context.window);

      if (documentDate) {
        validatedFields.offerDate = documentDate;
      }
    }
  } else {
    for (const fieldName of OFFER_ONLY_FIELDS) {
      delete validatedFields[fieldName];
    }
  }

  if (!APPRAISAL_VALUATION_TYPES.has(valuationType)) {
    for (const fieldName of APPRAISAL_ONLY_FIELDS) {
      delete validatedFields[fieldName];
    }
  } else if (!validatedFields.reportDate) {
    const documentDate = highConfidenceDocumentDate(context.window);

    if (documentDate) {
      validatedFields.reportDate = documentDate;
    }
  }

  const meaningfulValueFields = [
    "amount",
    "partTakenValue",
    "remainderDamages",
    "temporaryDamages",
    "costToCure",
  ];
  const hasMeaningfulValue = meaningfulValueFields.some((fieldName) =>
    typeof validatedFields[fieldName] === "string" &&
    validatedFields[fieldName].trim().length > 0,
  );

  if (!hasMeaningfulValue) {
    throw new Error("VALUATION facts require at least one stated valuation amount or component.");
  }

  return validatedFields;
}

function cleanAffectedFeature(value: string) {
  return value.trim().replace(/[.!?:;,]+$/g, "").trim();
}

function isSentenceLikeAffectedFeature(value: string) {
  return (
    value.length > 100 ||
    /\b(?:is|are|was|were|will|would|may|might|could|should|includes?|included|affects?|affected|identifies?|alleges?|assumes?|depicts?)\b/i.test(value) ||
    /^(?:the\s+)?(?:owner|appraisal|plans?|construction|taking|disputed taking)\b/i.test(value)
  );
}

function isFollowUpTaskDescription(value: string) {
  return /^(?:confirm|request|collect|obtain|ask|review|investigate|determine|verify|check|follow up|follow-up)\b/i.test(
    value.trim(),
  );
}

export function validateEminentDomainPropertyImpact(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  let validatedFields = { ...fields };

  if (
    typeof validatedFields.description === "string" &&
    isFollowUpTaskDescription(validatedFields.description)
  ) {
    throw new Error("PROPERTY_IMPACT facts must not be follow-up tasks or investigation requests.");
  }

  if (typeof validatedFields.affectedFeature === "string") {
    const affectedFeature = cleanAffectedFeature(validatedFields.affectedFeature);

    if (!affectedFeature || isSentenceLikeAffectedFeature(affectedFeature)) {
      delete validatedFields.affectedFeature;
    } else {
      validatedFields = {
        ...validatedFields,
        affectedFeature,
      };
    }
  }

  if (typeof validatedFields.sourceName === "string") {
    cleanOptionalStringField(validatedFields, "sourceName");
  }

  return validatedFields;
}
import type { ExtractionMarkdownWindow } from "../../types";
