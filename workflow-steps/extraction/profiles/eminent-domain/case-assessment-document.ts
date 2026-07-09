import type { EminentDomainAssessmentItem } from "./schema";
import { citationMarkdown } from "@/workflow-steps/document-editor/citations";

const NO_INFORMATION = "No information identified in the selected documents.";

function clean(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  return trimmedValue || null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map(clean).filter((value): value is string => Boolean(value)))];
}

function markdownEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function sentence(value: string) {
  const trimmedValue = value.trim();

  return /[.!?]$/.test(trimmedValue) ? trimmedValue : `${trimmedValue}.`;
}

function citedText(value: string | null | undefined) {
  return clean(value?.replace(/\*\*[^*]+:\*\*\s*/g, "").replace(/\*\*/g, ""));
}

function sourceNote(input: {
  sourceDocumentId?: string;
  sourceCitation?: string;
  sourceFileName: string;
}) {
  const citation = clean(input.sourceCitation);

  return citation
    ? `${input.sourceFileName}: ${citation}`
    : input.sourceFileName;
}

function noInformationSection(heading: string) {
  return [`## ${heading}`, "", NO_INFORMATION].join("\n");
}

function bulletSection(heading: string, bullets: Array<string | null | undefined>) {
  const cleanedBullets = unique(bullets);

  if (cleanedBullets.length === 0) {
    return noInformationSection(heading);
  }

  return [`## ${heading}`, "", ...cleanedBullets.map((item) => `- ${item}`)].join("\n");
}

function labeledValue(label: string, value: string | null | undefined) {
  const cleanedValue = clean(value);

  return cleanedValue ? `**${label}:** ${cleanedValue}` : null;
}

function sourceSuffix(input: {
  citedText?: string;
  sourceDocumentId?: string;
  sourceCitation?: string;
  sourceFileName: string;
}) {
  const citation = clean(input.sourceCitation);

  return ` ${citationMarkdown({
    citedText: citedText(input.citedText),
    locationText: citation,
    sourceDocumentId: input.sourceDocumentId,
    sourceDocumentName: input.sourceFileName,
  })}`;
}

function caseOverview(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) => {
    const overview = item.assessment.matterOverview;

    if (!overview) {
      return [];
    }

    return [
      labeledValue("Property owner", overview.propertyOwner),
      labeledValue("Condemning authority", overview.condemningAuthority),
      labeledValue("Project", overview.projectName),
      labeledValue("Property address", overview.propertyAddress),
      labeledValue("County", overview.county),
      labeledValue("Procedural posture", overview.proceduralPosture),
    ].map((value) => (value ? `${value}${sourceSuffix({ ...item, citedText: value })}` : null));
  });

  return bulletSection("Case Overview", bullets);
}

function timeline(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) =>
    (item.assessment.timeline ?? []).map((event) => {
      const prefix = clean(event.date) ? `**${event.date}:** ` : "";

      return `${prefix}${sentence(event.event)}${sourceSuffix({
        citedText: event.sourceExcerpt ?? event.event,
        sourceDocumentId: item.sourceDocumentId,
        sourceCitation: event.sourceCitation,
        sourceFileName: item.sourceFileName,
      })}`;
    }),
  );

  return bulletSection("Key Dates and Procedural Timeline", bullets);
}

function propertyInformation(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) => {
    const taking = item.assessment.takingSummary;

    if (!taking) {
      return [];
    }

    return [
      labeledValue("Type of taking", taking.typeOfTaking),
      labeledValue("Estate taken", taking.estateTaken),
      labeledValue("Area taken", taking.areaTaken),
      labeledValue("Remainder property", taking.remainderProperty),
      labeledValue("Project purpose", taking.projectPurpose),
      ...(taking.keyConcerns ?? []).map((concern) => labeledValue("Property concern", concern)),
    ].map((value) => (value ? `${value}${sourceSuffix({ ...item, citedText: value })}` : null));
  });

  return bulletSection("Property and Parcel Information", bullets);
}

function offerHistory(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) => {
    const valuation = item.assessment.valuationSummary;

    if (!valuation) {
      return [];
    }

    return [
      labeledValue("Initial offer", valuation.initialOffer),
      labeledValue("Final offer", valuation.finalOffer),
    ].map((value) => (value ? `${value}${sourceSuffix({ ...item, citedText: value })}` : null));
  });

  return bulletSection("Offer History", bullets);
}

function valuationIssues(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) => {
    const valuation = item.assessment.valuationSummary;

    if (!valuation) {
      return [];
    }

    return [
      labeledValue("Condemnor appraisal", valuation.condemnorAppraisal),
      labeledValue("Owner appraisal", valuation.ownerAppraisal),
      labeledValue("Part taken value", valuation.partTakenValue),
      labeledValue("Remainder damages", valuation.remainderDamages),
      labeledValue("Temporary damages", valuation.temporaryDamages),
      labeledValue("Cost to cure", valuation.costToCure),
      ...(valuation.valuationGaps ?? []).map((gap) => labeledValue("Valuation gap", gap)),
    ].map((value) => (value ? `${value}${sourceSuffix({ ...item, citedText: value })}` : null));
  });

  return bulletSection("Appraisal and Valuation Issues", bullets);
}

function accessAndRemainderIssues(items: EminentDomainAssessmentItem[]) {
  const issuePattern = /\b(access|parking|remainder|damage|driveway|signage|temporary)\b/i;
  const bullets = items.flatMap((item) => {
    const concerns = (item.assessment.takingSummary?.keyConcerns ?? [])
      .filter((concern) => issuePattern.test(concern))
      .map(
        (concern) =>
          `**Concern:** ${sentence(concern)}${sourceSuffix({
            ...item,
            citedText: concern,
          })}`,
      );
    const valuation = item.assessment.valuationSummary;
    const valuationBullets = [
      labeledValue("Remainder damages", valuation?.remainderDamages),
      labeledValue("Temporary damages", valuation?.temporaryDamages),
      labeledValue("Cost to cure", valuation?.costToCure),
    ].map((value) => (value ? `${value}${sourceSuffix({ ...item, citedText: value })}` : null));
    const flags = (item.assessment.proceduralFlags ?? [])
      .filter((flag) => issuePattern.test(`${flag.issue} ${flag.explanation}`))
      .map(
        (flag) =>
          `**${flag.issue}:** ${sentence(flag.explanation)}${sourceSuffix({
            citedText: flag.sourceExcerpt ?? flag.explanation,
            sourceDocumentId: item.sourceDocumentId,
            sourceCitation: flag.sourceCitation,
            sourceFileName: item.sourceFileName,
          })}`,
      );

    return [...concerns, ...valuationBullets, ...flags];
  });

  return bulletSection("Access, Parking, and Remainder-Damage Issues", bullets);
}

function proceduralFlags(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) =>
    (item.assessment.proceduralFlags ?? []).map((flag) => {
      const severity = clean(flag.severity) ? ` Severity: ${flag.severity}.` : "";

      return `**${flag.issue}:** ${sentence(flag.explanation)}${severity}${sourceSuffix({
        citedText: flag.sourceExcerpt ?? flag.explanation,
        sourceDocumentId: item.sourceDocumentId,
        sourceCitation: flag.sourceCitation,
        sourceFileName: item.sourceFileName,
      })}`;
    }),
  );

  return bulletSection("Procedural / Statutory Flags", bullets);
}

function missingInformation(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) =>
    (item.assessment.missingDocuments ?? []).map(
      (document) => `${sentence(document)}${sourceSuffix({ ...item, citedText: document })}`,
    ),
  );

  return bulletSection("Missing Documents or Information", bullets);
}

function recommendedNextActions(items: EminentDomainAssessmentItem[]) {
  const bullets = items.flatMap((item) =>
    (item.assessment.recommendedNextActions ?? []).map(
      (action) => `${sentence(action)}${sourceSuffix({ ...item, citedText: action })}`,
    ),
  );

  return bulletSection("Recommended Next Actions", bullets);
}

function sourceNotes(items: EminentDomainAssessmentItem[]) {
  const bullets = unique(
    items.flatMap((item) => [
      sourceNote(item),
      ...(item.assessment.timeline ?? []).map((event) =>
        sourceNote({
          sourceCitation: event.sourceCitation,
          sourceFileName: item.sourceFileName,
        }),
      ),
      ...(item.assessment.proceduralFlags ?? []).map((flag) =>
        sourceNote({
          sourceCitation: flag.sourceCitation,
          sourceFileName: item.sourceFileName,
        }),
      ),
    ]),
  ).map((note) => markdownEscape(note));

  return bulletSection("Source Notes", bullets);
}

export function composeEminentDomainCaseAssessment(
  items: EminentDomainAssessmentItem[],
) {
  return [
    "# Eminent Domain Case Assessment",
    "",
    caseOverview(items),
    "",
    timeline(items),
    "",
    propertyInformation(items),
    "",
    offerHistory(items),
    "",
    valuationIssues(items),
    "",
    accessAndRemainderIssues(items),
    "",
    proceduralFlags(items),
    "",
    missingInformation(items),
    "",
    recommendedNextActions(items),
    "",
    sourceNotes(items),
  ].join("\n");
}

export { NO_INFORMATION };
