import type { EminentDomainAssessmentItem } from "./schema";

export const LAWYER_MEMO_NO_INFORMATION =
  "No information identified in the selected documents.";

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

function sourceNote(input: {
  sourceCitation?: string;
  sourceFileName: string;
}) {
  const citation = clean(input.sourceCitation);

  return citation
    ? `${input.sourceFileName}: ${citation}`
    : input.sourceFileName;
}

function sourceSuffix(input: {
  sourceCitation?: string;
  sourceFileName: string;
}) {
  return ` _(Source: ${sourceNote(input)})_`;
}

function section(heading: string, paragraphs: Array<string | null | undefined>) {
  const content = unique(paragraphs);

  if (content.length === 0) {
    return [`## ${heading}`, "", LAWYER_MEMO_NO_INFORMATION].join("\n");
  }

  return [`## ${heading}`, "", ...content.map((item) => `- ${item}`)].join("\n");
}

function reviewedAssessmentSummary(markdown: string | null | undefined) {
  const lines = (markdown ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => line !== LAWYER_MEMO_NO_INFORMATION)
    .slice(0, 8);

  return lines.length
    ? [
        "The reviewed case assessment includes the following lawyer-edited narrative points:",
        ...lines.map((line) => line.replace(/^[-*]\s+/, "")),
      ]
    : [];
}

function caseParties(items: EminentDomainAssessmentItem[]) {
  return unique(
    items.flatMap((item) => [
      item.assessment.matterOverview?.propertyOwner
        ? `Property owner: ${item.assessment.matterOverview.propertyOwner}${sourceSuffix(item)}`
        : null,
      item.assessment.matterOverview?.condemningAuthority
        ? `Condemning authority: ${item.assessment.matterOverview.condemningAuthority}${sourceSuffix(item)}`
        : null,
      item.assessment.matterOverview?.projectName
        ? `Project: ${item.assessment.matterOverview.projectName}${sourceSuffix(item)}`
        : null,
    ]),
  );
}

function timelineFacts(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.timeline ?? []).map((event) => {
      const date = clean(event.date) ? `${event.date}: ` : "";

      return `${date}${sentence(event.event)}${sourceSuffix({
        sourceCitation: event.sourceCitation,
        sourceFileName: item.sourceFileName,
      })}`;
    }),
  );
}

function valuationFacts(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) => {
    const valuation = item.assessment.valuationSummary;

    if (!valuation) {
      return [];
    }

    return [
      valuation.initialOffer ? `Initial offer: ${valuation.initialOffer}` : null,
      valuation.finalOffer ? `Final offer: ${valuation.finalOffer}` : null,
      valuation.condemnorAppraisal
        ? `Condemnor appraisal: ${valuation.condemnorAppraisal}`
        : null,
      valuation.ownerAppraisal ? `Owner appraisal: ${valuation.ownerAppraisal}` : null,
      valuation.remainderDamages
        ? `Remainder damages: ${valuation.remainderDamages}`
        : null,
      valuation.temporaryDamages
        ? `Temporary damages: ${valuation.temporaryDamages}`
        : null,
      valuation.costToCure ? `Cost to cure: ${valuation.costToCure}` : null,
      ...(valuation.valuationGaps ?? []).map((gap) => `Valuation gap: ${gap}`),
    ].map((value) => (value ? `${value}${sourceSuffix(item)}` : null));
  });
}

function accessFacts(items: EminentDomainAssessmentItem[]) {
  const pattern = /\b(access|parking|remainder|damage|driveway|signage|temporary)\b/i;

  return items.flatMap((item) => {
    const concerns = (item.assessment.takingSummary?.keyConcerns ?? [])
      .filter((concern) => pattern.test(concern))
      .map((concern) => `${sentence(concern)}${sourceSuffix(item)}`);
    const flags = (item.assessment.proceduralFlags ?? [])
      .filter((flag) => pattern.test(`${flag.issue} ${flag.explanation}`))
      .map(
        (flag) =>
          `${flag.issue}: ${sentence(flag.explanation)}${sourceSuffix({
            sourceCitation: flag.sourceCitation,
            sourceFileName: item.sourceFileName,
          })}`,
      );

    return [...concerns, ...flags];
  });
}

function proceduralFlags(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.proceduralFlags ?? []).map((flag) => {
      const severity = clean(flag.severity) ? ` Severity: ${flag.severity}.` : "";

      return `${flag.issue}: ${sentence(flag.explanation)}${severity}${sourceSuffix({
        sourceCitation: flag.sourceCitation,
        sourceFileName: item.sourceFileName,
      })}`;
    }),
  );
}

function missingInformation(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.missingDocuments ?? []).map(
      (missing) => `${sentence(missing)}${sourceSuffix(item)}`,
    ),
  );
}

function nextActions(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.recommendedNextActions ?? []).map(
      (action) => `${sentence(action)}${sourceSuffix(item)}`,
    ),
  );
}

function sourceNotes(items: EminentDomainAssessmentItem[]) {
  return unique(
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
  );
}

export function composeEminentDomainLawyerMemo(input: {
  items: EminentDomainAssessmentItem[];
  reviewedCaseAssessmentMarkdown?: string | null;
}) {
  const reviewedSummary = reviewedAssessmentSummary(
    input.reviewedCaseAssessmentMarkdown,
  );
  const parties = caseParties(input.items);
  const timeline = timelineFacts(input.items);
  const valuation = valuationFacts(input.items);
  const access = accessFacts(input.items);
  const flags = proceduralFlags(input.items);
  const missing = missingInformation(input.items);
  const actions = nextActions(input.items);

  return [
    "# Lawyer Memo",
    "",
    section("Issue Presented", [
      parties.length
        ? "The available documents suggest the matter concerns an eminent-domain taking affecting the identified owner, condemning authority, and project. The immediate issue is how the current record affects litigation posture, valuation, procedural risks, and next legal steps."
        : null,
    ]),
    "",
    section("Brief Answer", [
      input.items.length > 0
        ? "The available documents suggest the file is ready for preliminary issue review, but the record should be treated as incomplete until missing valuation, procedural, and property-impact materials are confirmed."
        : null,
    ]),
    "",
    section("Relevant Facts", reviewedSummary.length ? reviewedSummary : parties),
    "",
    section("Procedural Posture", timeline),
    "",
    section("Valuation and Damages Issues", valuation),
    "",
    section("Access, Parking, and Remainder-Damage Issues", access),
    "",
    section("Legal and Procedural Flags", flags),
    "",
    section("Missing Information", missing),
    "",
    section("Strategic Considerations", [
      valuation.length
        ? "This may require follow-up on appraisal support, valuation assumptions, and any unaddressed remainder-damage theories."
        : null,
      access.length
        ? "The available documents suggest access, parking, or remainder impacts may affect both valuation and negotiation strategy."
        : null,
      missing.length
        ? "The record does not currently show all materials needed for a complete legal and valuation assessment."
        : null,
    ]),
    "",
    section("Recommended Next Steps", actions),
    "",
    section("Source Notes", sourceNotes(input.items)),
  ].join("\n");
}
