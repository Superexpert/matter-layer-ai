import type { EminentDomainAssessmentItem } from "./schema";

export const CLIENT_SUMMARY_NOT_IDENTIFIED =
  "We did not identify information about this issue in the selected documents.";

function clean(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  return trimmedValue || null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map(clean).filter((value): value is string => Boolean(value)))];
}

function sentence(value: string) {
  const trimmedValue = value.trim();

  return /[.!?]$/.test(trimmedValue) ? trimmedValue : `${trimmedValue}.`;
}

function section(heading: string, paragraphs: Array<string | null | undefined>) {
  const content = unique(paragraphs);

  if (content.length === 0) {
    return [`## ${heading}`, "", CLIENT_SUMMARY_NOT_IDENTIFIED].join("\n");
  }

  return [`## ${heading}`, "", ...content.map((item) => `- ${item}`)].join("\n");
}

function reviewedWorkProductNotes(markdown: string | null | undefined) {
  return (markdown ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => line !== CLIENT_SUMMARY_NOT_IDENTIFIED)
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .slice(0, 6);
}

function reviewedDocuments(items: EminentDomainAssessmentItem[]) {
  return unique(items.map((item) => item.sourceFileName));
}

function overview(items: EminentDomainAssessmentItem[]) {
  return unique(
    items.flatMap((item) => {
      const overview = item.assessment.matterOverview;
      const taking = item.assessment.takingSummary;

      return [
        overview?.propertyOwner
          ? `The available documents appear to identify ${overview.propertyOwner} as the property owner.`
          : null,
        overview?.condemningAuthority
          ? `The available documents identify ${overview.condemningAuthority} as the condemning authority.`
          : null,
        overview?.projectName
          ? `The matter appears connected to ${overview.projectName}.`
          : null,
        taking?.typeOfTaking
          ? `Based on the documents reviewed, the matter appears to involve ${taking.typeOfTaking}.`
          : null,
        taking?.projectPurpose
          ? `The stated project purpose appears to be ${taking.projectPurpose}.`
          : null,
      ];
    }),
  );
}

function timeline(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.timeline ?? []).map((event) => {
      const date = clean(event.date) ? `${event.date}: ` : "";

      return `${date}${sentence(event.event)}`;
    }),
  );
}

function importantIssues(items: EminentDomainAssessmentItem[]) {
  return unique(
    items.flatMap((item) => {
      const taking = item.assessment.takingSummary;
      const valuation = item.assessment.valuationSummary;

      return [
        ...(taking?.keyConcerns ?? []).map(
          (concern) => `The documents flag this issue for discussion: ${sentence(concern)}`,
        ),
        valuation?.initialOffer
          ? `The documents mention an initial offer of ${valuation.initialOffer}.`
          : null,
        valuation?.finalOffer
          ? `The documents mention a final offer of ${valuation.finalOffer}.`
          : null,
        valuation?.remainderDamages
          ? `The documents mention possible remainder-damage concerns: ${sentence(valuation.remainderDamages)}`
          : null,
        valuation?.temporaryDamages
          ? `The documents mention possible temporary-damage concerns: ${sentence(valuation.temporaryDamages)}`
          : null,
        ...(valuation?.valuationGaps ?? []).map(
          (gap) => `The available documents may leave this valuation question open: ${sentence(gap)}`,
        ),
        ...(item.assessment.proceduralFlags ?? []).map(
          (flag) => `This may be something to discuss with your lawyer: ${flag.issue}. ${sentence(flag.explanation)}`,
        ),
      ];
    }),
  );
}

function missingInformation(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.missingDocuments ?? []).map((missing) => sentence(missing)),
  );
}

function clientNeeds(items: EminentDomainAssessmentItem[]) {
  const missing = missingInformation(items);
  const accessConcerns = items.flatMap((item) =>
    (item.assessment.takingSummary?.keyConcerns ?? []).filter((concern) =>
      /\b(access|parking|driveway|signage|business|remainder)\b/i.test(concern),
    ),
  );

  return [
    ...missing.map((item) => `We may need your help locating or confirming: ${item}`),
    ...accessConcerns.map(
      (concern) =>
        `We may need practical details from you about this issue: ${sentence(concern)}`,
    ),
  ];
}

function nextSteps(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.recommendedNextActions ?? []).map(
      (action) => `A possible next step is to ${sentence(action).replace(/^To\s+/i, "")}`,
    ),
  );
}

export function composeEminentDomainClientSummary(input: {
  items: EminentDomainAssessmentItem[];
  reviewedCaseAssessmentMarkdown?: string | null;
  reviewedLawyerMemoMarkdown?: string | null;
}) {
  const reviewedNotes = [
    ...reviewedWorkProductNotes(input.reviewedCaseAssessmentMarkdown),
    ...reviewedWorkProductNotes(input.reviewedLawyerMemoMarkdown),
  ];

  return [
    "# Client Summary",
    "",
    section("Overview", reviewedNotes.length ? reviewedNotes : overview(input.items)),
    "",
    section("What We Reviewed", reviewedDocuments(input.items)),
    "",
    section("What Has Happened So Far", timeline(input.items)),
    "",
    section("Important Issues", importantIssues(input.items)),
    "",
    section("Questions or Missing Information", missingInformation(input.items)),
    "",
    section("What We May Need From You", clientNeeds(input.items)),
    "",
    section("Possible Next Steps", nextSteps(input.items)),
    "",
    "## Important Note",
    "",
    "This summary is a draft prepared for attorney review. It should be reviewed and approved by the lawyer before being sent to the client.",
  ].join("\n");
}
