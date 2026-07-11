import type { BuiltInWorkflowDefinition, WorkflowDefinition } from "@/services/workflows/types";

const generators = [
  {
    id: "valuation-summary", name: "Valuation Summary", outputName: "Valuation Summary",
    instructions: "Create ordered rows for the effective date, property interest, larger parcel, acquisition area, highest and best use before and after, approaches, before value, part taken, after value, remainder damages, enhancements, cost to cure, and total compensation. Each row must state the appraiser conclusion, stated basis, cautious review notes, and direct citation IDs.",
  },
  {
    id: "assumptions-impacts", name: "Assumptions and Property Impacts", outputName: "Assumptions and Property Impacts",
    instructions: "Create rows for access, visibility, parking, drainage, utilities, frontage, parcel configuration, circulation, development potential, temporary impacts, extraordinary assumptions, hypothetical conditions, and relied-upon project plans. Distinguish appraisal positions from supporting-document evidence and frame omissions or conflicts as questions.",
  },
  {
    id: "comparable-sales", name: "Comparable Sales Review", outputName: "Comparable Sales Review",
    instructions: "Create one row per comparable summarizing location, date, price or unit price, characteristics, adjustments, adjusted indication, and appraiser explanation. Flag large or unclear adjustments, different zoning/access/development status, remote dates or markets, and missing details only as matters for review.",
  },
  {
    id: "missing-evidence-questions", name: "Missing Evidence and Questions", outputName: "Missing Evidence and Questions",
    instructions: "List only documents expressly referenced but unavailable, unresolved factual issues, unsupported sections, conflicts, and focused questions for counsel, the owner, or the appraiser. Do not invent missing documents merely because they are customary.",
  },
  {
    id: "executive-summary", name: "Executive Review Summary", outputName: "Executive Review Summary",
    instructions: "Summarize the appraisal's central valuation theory, compensation drivers, consequential assumptions, principal issues for attorney attention, and next investigation steps. Clearly distinguish appraisal conclusions from review questions and never claim an independent appraisal was performed.",
  },
];

export const condemnorAppraisalReviewDefinition: WorkflowDefinition = {
  category: "Eminent Domain",
  description: "Review a condemnor’s appraisal, summarize its valuation methodology and conclusions, identify important assumptions and omissions, and generate questions for counsel.",
  id: "condemnor-appraisal-review",
  name: "Condemnor Appraisal Review",
  steps: [
    {
      description: "Select the condemnor’s appraisal and any supporting matter files that may help evaluate its assumptions, valuation conclusions, and treatment of the remainder property.",
      id: "select-appraisal-files", name: "Select Appraisal Files", type: "fileSelector",
      parameters: { acceptedMimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"], allowExistingMatterFiles: true, allowUpload: true, maxFiles: null, minFiles: 1 },
    },
    {
      autorun: true,
      description: "Extract structured, cited appraisal facts from the selected documents.",
      id: "extract-appraisal-facts", name: "Extract Appraisal Facts", type: "extraction",
      parameters: { inputStepId: "select-appraisal-files", outputKey: "condemnorAppraisalReview", profile: "condemnor-appraisal-review", representationType: "MARKDOWN", taskId: "condemnor-appraisal-review", ui: { profileLine: null, retryButtonLabel: "Retry extraction", runButtonLabel: "Extract appraisal facts", runningButtonLabel: "Extracting...", runningDocumentLabel: "Extracting" } },
    },
    {
      autorun: true,
      description: "Analyze the cited appraisal facts in parallel and prepare one structured review.",
      id: "analyze-appraisal", name: "Analyze Appraisal", type: "analyze",
      parameters: { aggregate: { outputName: "Condemnor Appraisal Review", renderer: "condemnor-appraisal-review" }, generators, inputStepId: "extract-appraisal-facts" },
    },
    {
      description: "Review and edit the generated appraisal review.",
      id: "review-appraisal", name: "Review Condemnor Appraisal", type: "reviewWorkProducts",
      parameters: { inputStepId: "analyze-appraisal" },
    },
  ],
};

export const condemnorAppraisalReviewBuiltIn: BuiltInWorkflowDefinition = {
  builtInVersion: 1,
  definition: condemnorAppraisalReviewDefinition,
  isEnabledByDefault: true,
  isSystem: false,
  slug: "condemnor-appraisal-review",
};
