import { extractModelOutputItems } from "../../json-output";
import type { ExtractionWarning } from "../../types";

export const EMINENT_DOMAIN_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const EMINENT_DOMAIN_SEVERITY_VALUES = ["high", "medium", "low"] as const;

export type EminentDomainConfidence =
  (typeof EMINENT_DOMAIN_CONFIDENCE_VALUES)[number];
export type EminentDomainSeverity =
  (typeof EMINENT_DOMAIN_SEVERITY_VALUES)[number];

export type EminentDomainCaseAssessment = {
  matterOverview?: {
    propertyOwner?: string;
    condemningAuthority?: string;
    projectName?: string;
    propertyAddress?: string;
    county?: string;
    proceduralPosture?: string;
  };
  timeline?: Array<{
    date?: string;
    event: string;
    sourceCitation?: string;
    confidence?: EminentDomainConfidence;
  }>;
  takingSummary?: {
    typeOfTaking?: string;
    estateTaken?: string;
    areaTaken?: string;
    remainderProperty?: string;
    projectPurpose?: string;
    keyConcerns?: string[];
  };
  valuationSummary?: {
    initialOffer?: string;
    finalOffer?: string;
    condemnorAppraisal?: string;
    ownerAppraisal?: string;
    partTakenValue?: string;
    remainderDamages?: string;
    temporaryDamages?: string;
    costToCure?: string;
    valuationGaps?: string[];
  };
  proceduralFlags?: Array<{
    issue: string;
    explanation: string;
    severity?: EminentDomainSeverity;
    sourceCitation?: string;
  }>;
  missingDocuments?: string[];
  recommendedNextActions?: string[];
};

export type EminentDomainAssessmentItem = {
  assessment: EminentDomainCaseAssessment;
  sourceDocumentId: string;
  sourceFileName: string;
};

function optionalString(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Eminent domain assessment ${fieldName} must be a string.`);
  }

  return value.trim();
}

function optionalStringArray(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Eminent domain assessment ${fieldName} must be an array of strings.`);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function objectRecord(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Eminent domain assessment ${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function confidence(value: unknown) {
  const parsed = optionalString(value, "confidence");

  if (!parsed) {
    return undefined;
  }

  if (!EMINENT_DOMAIN_CONFIDENCE_VALUES.includes(parsed as EminentDomainConfidence)) {
    throw new Error(`Unsupported eminent domain assessment confidence: ${parsed}`);
  }

  return parsed as EminentDomainConfidence;
}

function severity(value: unknown) {
  const parsed = optionalString(value, "severity");

  if (!parsed) {
    return undefined;
  }

  if (!EMINENT_DOMAIN_SEVERITY_VALUES.includes(parsed as EminentDomainSeverity)) {
    throw new Error(`Unsupported eminent domain assessment severity: ${parsed}`);
  }

  return parsed as EminentDomainSeverity;
}

function timeline(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("Eminent domain assessment timeline must be an array.");
  }

  return value.map((item) => {
    const rawItem = objectRecord(item, "timeline item");
    const event = optionalString(rawItem?.event, "timeline.event");

    if (!event) {
      throw new Error("Eminent domain assessment timeline event is required.");
    }

    return {
      confidence: confidence(rawItem?.confidence),
      date: optionalString(rawItem?.date, "timeline.date"),
      event,
      sourceCitation: optionalString(rawItem?.sourceCitation, "timeline.sourceCitation"),
    };
  });
}

function proceduralFlags(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("Eminent domain assessment proceduralFlags must be an array.");
  }

  return value.map((item) => {
    const rawItem = objectRecord(item, "procedural flag");
    const issue = optionalString(rawItem?.issue, "proceduralFlags.issue");
    const explanation = optionalString(
      rawItem?.explanation,
      "proceduralFlags.explanation",
    );

    if (!issue || !explanation) {
      throw new Error(
        "Eminent domain assessment procedural flags require issue and explanation.",
      );
    }

    return {
      explanation,
      issue,
      severity: severity(rawItem?.severity),
      sourceCitation: optionalString(
        rawItem?.sourceCitation,
        "proceduralFlags.sourceCitation",
      ),
    };
  });
}

function validateAssessment(value: unknown): EminentDomainCaseAssessment {
  const rawAssessment = objectRecord(value, "assessment");

  if (!rawAssessment) {
    throw new Error("Eminent domain assessment must be an object.");
  }

  const matterOverview = objectRecord(rawAssessment.matterOverview, "matterOverview");
  const takingSummary = objectRecord(rawAssessment.takingSummary, "takingSummary");
  const valuationSummary = objectRecord(
    rawAssessment.valuationSummary,
    "valuationSummary",
  );

  return {
    matterOverview: matterOverview
      ? {
          condemningAuthority: optionalString(
            matterOverview.condemningAuthority,
            "matterOverview.condemningAuthority",
          ),
          county: optionalString(matterOverview.county, "matterOverview.county"),
          proceduralPosture: optionalString(
            matterOverview.proceduralPosture,
            "matterOverview.proceduralPosture",
          ),
          projectName: optionalString(
            matterOverview.projectName,
            "matterOverview.projectName",
          ),
          propertyAddress: optionalString(
            matterOverview.propertyAddress,
            "matterOverview.propertyAddress",
          ),
          propertyOwner: optionalString(
            matterOverview.propertyOwner,
            "matterOverview.propertyOwner",
          ),
        }
      : undefined,
    missingDocuments: optionalStringArray(
      rawAssessment.missingDocuments,
      "missingDocuments",
    ),
    proceduralFlags: proceduralFlags(rawAssessment.proceduralFlags),
    recommendedNextActions: optionalStringArray(
      rawAssessment.recommendedNextActions,
      "recommendedNextActions",
    ),
    takingSummary: takingSummary
      ? {
          areaTaken: optionalString(takingSummary.areaTaken, "takingSummary.areaTaken"),
          estateTaken: optionalString(
            takingSummary.estateTaken,
            "takingSummary.estateTaken",
          ),
          keyConcerns: optionalStringArray(
            takingSummary.keyConcerns,
            "takingSummary.keyConcerns",
          ),
          projectPurpose: optionalString(
            takingSummary.projectPurpose,
            "takingSummary.projectPurpose",
          ),
          remainderProperty: optionalString(
            takingSummary.remainderProperty,
            "takingSummary.remainderProperty",
          ),
          typeOfTaking: optionalString(
            takingSummary.typeOfTaking,
            "takingSummary.typeOfTaking",
          ),
        }
      : undefined,
    timeline: timeline(rawAssessment.timeline),
    valuationSummary: valuationSummary
      ? {
          condemnorAppraisal: optionalString(
            valuationSummary.condemnorAppraisal,
            "valuationSummary.condemnorAppraisal",
          ),
          costToCure: optionalString(
            valuationSummary.costToCure,
            "valuationSummary.costToCure",
          ),
          finalOffer: optionalString(
            valuationSummary.finalOffer,
            "valuationSummary.finalOffer",
          ),
          initialOffer: optionalString(
            valuationSummary.initialOffer,
            "valuationSummary.initialOffer",
          ),
          ownerAppraisal: optionalString(
            valuationSummary.ownerAppraisal,
            "valuationSummary.ownerAppraisal",
          ),
          partTakenValue: optionalString(
            valuationSummary.partTakenValue,
            "valuationSummary.partTakenValue",
          ),
          remainderDamages: optionalString(
            valuationSummary.remainderDamages,
            "valuationSummary.remainderDamages",
          ),
          temporaryDamages: optionalString(
            valuationSummary.temporaryDamages,
            "valuationSummary.temporaryDamages",
          ),
          valuationGaps: optionalStringArray(
            valuationSummary.valuationGaps,
            "valuationSummary.valuationGaps",
          ),
        }
      : undefined,
  };
}

export function parseEminentDomainAssessmentOutput(
  content: string,
  context: {
    sourceDocumentId: string;
    sourceFileName: string;
  },
) {
  const parsed = extractModelOutputItems({
    content,
    itemKeys: ["assessments", "eminentDomainCaseAssessments"],
  });
  const warnings: ExtractionWarning[] = [];
  const assessments = parsed.items.map((item): EminentDomainAssessmentItem => ({
    assessment: validateAssessment(item),
    sourceDocumentId: context.sourceDocumentId,
    sourceFileName: context.sourceFileName,
  }));

  if (assessments.length === 0) {
    warnings.push({
      code: "eminent_domain_assessment.empty",
      message: "No eminent domain assessment items were extracted.",
      severity: "warning",
    });
  }

  return {
    assessments,
    warnings,
  };
}
