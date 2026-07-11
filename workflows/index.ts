import { chronologyBuiltIn } from "./chronology.workflow";
import { condemnorAppraisalReviewBuiltIn } from "./condemnor-appraisal-review.workflow";
import { eminentDomainCaseAssessmentBuiltIn } from "./eminent-domain-case-assessment.workflow";
import { workflowBuilderBuiltIn } from "./workflow-builder.workflow";

export const builtInWorkflows = [
  chronologyBuiltIn,
  condemnorAppraisalReviewBuiltIn,
  eminentDomainCaseAssessmentBuiltIn,
  workflowBuilderBuiltIn,
];

export { chronologyDefinition } from "./chronology.workflow";
export { condemnorAppraisalReviewDefinition } from "./condemnor-appraisal-review.workflow";
export { eminentDomainCaseAssessmentDefinition } from "./eminent-domain-case-assessment.workflow";
export { workflowBuilderDefinition } from "./workflow-builder.workflow";
