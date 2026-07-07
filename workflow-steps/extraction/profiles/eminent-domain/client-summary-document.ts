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

function reviewedMemoSection(input: {
  headings: string[];
  markdown: string;
  maxItems?: number;
}) {
  const lines = input.markdown.split("\n");
  const sections = new Map<string, string[]>();
  let activeHeading: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headingMatch = line.match(/^##\s+(.+)$/);

    if (headingMatch) {
      activeHeading = headingMatch[1]?.trim() ?? null;
      if (activeHeading && !sections.has(activeHeading)) {
        sections.set(activeHeading, []);
      }
      continue;
    }

    if (!activeHeading || !line || line === CLIENT_SUMMARY_NOT_IDENTIFIED) {
      continue;
    }

    sections.get(activeHeading)?.push(line.replace(/^[-*]\s+/, ""));
  }

  return unique(
    input.headings.flatMap((heading) => sections.get(heading) ?? []),
  ).slice(0, input.maxItems ?? 6);
}

function clientSafeMemoNotes(notes: string[]) {
  return notes
    .filter((note) => !/\b(strategy|strategic|privileged|work product)\b/i.test(note))
    .map((note) =>
      note
        .replace(/\s*_\((Source:[^)]+)\)_/g, "")
        .replace(/^Risk:\s*/i, "")
        .replace(/^Strategic consideration:\s*/i, "")
        .trim(),
    )
    .filter((note) => note.length > 0);
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
  const reviewedMemoMarkdown = clean(input.reviewedLawyerMemoMarkdown);

  if (!reviewedMemoMarkdown) {
    throw new Error("A reviewed lawyer memo is required to compose a client summary.");
  }

  const overviewNotes = clientSafeMemoNotes([
    ...reviewedMemoSection({
      headings: ["Key Facts", "Property and Taking Summary"],
      markdown: reviewedMemoMarkdown,
      maxItems: 6,
    }),
    ...reviewedWorkProductNotes(input.reviewedCaseAssessmentMarkdown),
  ]);
  const timelineNotes = clientSafeMemoNotes(
    reviewedMemoSection({
      headings: ["Procedural Posture"],
      markdown: reviewedMemoMarkdown,
      maxItems: 6,
    }),
  );
  const issueNotes = clientSafeMemoNotes(
    reviewedMemoSection({
      headings: [
        "Offer History",
        "Valuation and Damages Issues",
        "Access, Parking, and Remainder-Damage Issues",
        "Legal and Procedural Flags",
      ],
      markdown: reviewedMemoMarkdown,
      maxItems: 8,
    }),
  );
  const questionNotes = clientSafeMemoNotes(
    reviewedMemoSection({
      headings: ["Missing Documents and Open Questions", "Missing Information"],
      markdown: reviewedMemoMarkdown,
      maxItems: 6,
    }),
  );
  const nextStepNotes = clientSafeMemoNotes(
    reviewedMemoSection({
      headings: ["Recommended Next Steps"],
      markdown: reviewedMemoMarkdown,
      maxItems: 6,
    }),
  );

  return [
    "# Client Summary",
    "",
    section("Overview", overviewNotes.length ? overviewNotes : overview(input.items)),
    "",
    section("What We Reviewed", reviewedDocuments(input.items)),
    "",
    section(
      "What Has Happened So Far",
      timelineNotes.length ? timelineNotes : timeline(input.items),
    ),
    "",
    section(
      "Important Issues",
      issueNotes.length ? issueNotes : importantIssues(input.items),
    ),
    "",
    section(
      "Questions or Missing Information",
      questionNotes.length ? questionNotes : missingInformation(input.items),
    ),
    "",
    section(
      "What We May Need From You",
      questionNotes.length ? questionNotes : clientNeeds(input.items),
    ),
    "",
    section(
      "Possible Next Steps",
      nextStepNotes.length ? nextStepNotes : nextSteps(input.items),
    ),
    "",
    "## Important Note",
    "",
    "This summary is based on the reviewed lawyer memo. It is intended for client communication and omits internal legal strategy.",
  ].join("\n");
}
