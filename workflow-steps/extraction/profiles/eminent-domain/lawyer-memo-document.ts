import type { EminentDomainAssessmentItem } from "./schema";
import { citationMarkdown } from "@/workflow-steps/document-editor/citations";

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

function section(heading: string, paragraphs: Array<string | null | undefined>) {
  const content = unique(paragraphs);

  if (content.length === 0) {
    return [`## ${heading}`, "", LAWYER_MEMO_NO_INFORMATION].join("\n");
  }

  return [`## ${heading}`, "", ...content.map((item) => `- ${item}`)].join("\n");
}

function caseParties(items: EminentDomainAssessmentItem[]) {
  return unique(
    items.flatMap((item) => [
      item.assessment.matterOverview?.propertyOwner
        ? `Property owner: ${item.assessment.matterOverview.propertyOwner}${sourceSuffix({
          ...item,
          citedText: item.assessment.matterOverview.propertyOwner,
        })}`
        : null,
      item.assessment.matterOverview?.condemningAuthority
        ? `Condemning authority: ${item.assessment.matterOverview.condemningAuthority}${sourceSuffix({
          ...item,
          citedText: item.assessment.matterOverview.condemningAuthority,
        })}`
        : null,
      item.assessment.matterOverview?.projectName
        ? `Project: ${item.assessment.matterOverview.projectName}${sourceSuffix({
          ...item,
          citedText: item.assessment.matterOverview.projectName,
        })}`
        : null,
    ]),
  );
}

function takingFacts(items: EminentDomainAssessmentItem[]) {
  return unique(
    items.flatMap((item) => {
      const overview = item.assessment.matterOverview;
      const taking = item.assessment.takingSummary;

      return [
        overview?.propertyAddress
          ? `Property: ${overview.propertyAddress}${sourceSuffix({
            ...item,
            citedText: overview.propertyAddress,
          })}`
          : null,
        overview?.county
          ? `County: ${overview.county}${sourceSuffix({
            ...item,
            citedText: overview.county,
          })}`
          : null,
        taking?.typeOfTaking
          ? `Type of taking: ${taking.typeOfTaking}${sourceSuffix({
            ...item,
            citedText: taking.typeOfTaking,
          })}`
          : null,
        taking?.estateTaken
          ? `Estate taken: ${taking.estateTaken}${sourceSuffix({
            ...item,
            citedText: taking.estateTaken,
          })}`
          : null,
        taking?.areaTaken
          ? `Area taken: ${taking.areaTaken}${sourceSuffix({
            ...item,
            citedText: taking.areaTaken,
          })}`
          : null,
        taking?.remainderProperty
          ? `Remainder property: ${taking.remainderProperty}${sourceSuffix({
            ...item,
            citedText: taking.remainderProperty,
          })}`
          : null,
        taking?.projectPurpose
          ? `Project purpose: ${taking.projectPurpose}${sourceSuffix({
            ...item,
            citedText: taking.projectPurpose,
          })}`
          : null,
        ...(taking?.keyConcerns ?? []).map(
          (concern) => `Taking concern: ${sentence(concern)}${sourceSuffix({
            ...item,
            citedText: concern,
          })}`,
        ),
      ];
    }),
  );
}

function timelineFacts(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.timeline ?? []).map((event) => {
      const date = clean(event.date) ? `${event.date}: ` : "";

      return `${date}${sentence(event.event)}${sourceSuffix({
        citedText: event.sourceExcerpt ?? event.event,
        sourceDocumentId: item.sourceDocumentId,
        sourceCitation: event.sourceCitation,
        sourceFileName: item.sourceFileName,
      })}`;
    }),
  );
}

function proceduralPosture(items: EminentDomainAssessmentItem[]) {
  return unique(
    items.flatMap((item) => [
      item.assessment.matterOverview?.proceduralPosture
        ? `${sentence(item.assessment.matterOverview.proceduralPosture)}${sourceSuffix({
          ...item,
          citedText: item.assessment.matterOverview.proceduralPosture,
        })}`
        : null,
      ...timelineFacts([item]),
    ]),
  );
}

function offerHistoryFacts(items: EminentDomainAssessmentItem[]) {
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
    ].map((value) => (value ? `${value}${sourceSuffix({ ...item, citedText: value })}` : null));
  });
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
    ].map((value) => (value ? `${value}${sourceSuffix({ ...item, citedText: value })}` : null));
  });
}

function accessFacts(items: EminentDomainAssessmentItem[]) {
  const pattern = /\b(access|parking|remainder|damage|driveway|signage|temporary)\b/i;

  return items.flatMap((item) => {
    const concerns = (item.assessment.takingSummary?.keyConcerns ?? [])
      .filter((concern) => pattern.test(concern))
      .map((concern) => `${sentence(concern)}${sourceSuffix({
        ...item,
        citedText: concern,
      })}`);
    const flags = (item.assessment.proceduralFlags ?? [])
      .filter((flag) => pattern.test(`${flag.issue} ${flag.explanation}`))
      .map(
        (flag) =>
          `${flag.issue}: ${sentence(flag.explanation)}${sourceSuffix({
            citedText: flag.sourceExcerpt ?? flag.explanation,
            sourceDocumentId: item.sourceDocumentId,
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
        citedText: flag.sourceExcerpt ?? flag.explanation,
        sourceDocumentId: item.sourceDocumentId,
        sourceCitation: flag.sourceCitation,
        sourceFileName: item.sourceFileName,
      })}`;
    }),
  );
}

function missingInformation(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.missingDocuments ?? []).map(
      (missing) => `${sentence(missing)}${sourceSuffix({ ...item, citedText: missing })}`,
    ),
  );
}

function nextActions(items: EminentDomainAssessmentItem[]) {
  return items.flatMap((item) =>
    (item.assessment.recommendedNextActions ?? []).map(
      (action) => `${sentence(action)}${sourceSuffix({ ...item, citedText: action })}`,
    ),
  );
}

function risksAndStrategy(items: EminentDomainAssessmentItem[]) {
  return unique([
    ...proceduralFlags(items).map((flag) => `Risk: ${flag}`),
    ...missingInformation(items).map((missing) => `Open question: ${missing}`),
    ...valuationFacts(items)
      .filter((fact) =>
        /\b(gap|damage|cost|appraisal|offer|remainder|temporary)\b/i.test(fact ?? ""),
      )
      .map((fact) => `Strategic consideration: ${fact}`),
    ...accessFacts(items).map((fact) => `Strategic consideration: ${fact}`),
  ]);
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
}) {
  const parties = caseParties(input.items);
  const taking = takingFacts(input.items);
  const posture = proceduralPosture(input.items);
  const offers = offerHistoryFacts(input.items);
  const valuation = valuationFacts(input.items);
  const access = accessFacts(input.items);
  const flags = proceduralFlags(input.items);
  const missing = missingInformation(input.items);
  const risks = risksAndStrategy(input.items);
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
    section("Key Facts", parties),
    "",
    section("Property and Taking Summary", taking),
    "",
    section("Offer History", offers),
    "",
    section("Procedural Posture", posture),
    "",
    section("Valuation and Damages Issues", valuation),
    "",
    section("Access, Parking, and Remainder-Damage Issues", access),
    "",
    section("Legal and Procedural Flags", flags),
    "",
    section("Missing Documents and Open Questions", missing),
    "",
    section("Risks and Strategic Considerations", risks),
    "",
    section("Recommended Next Steps", actions),
    "",
    section("Source Notes", sourceNotes(input.items)),
  ].join("\n");
}
