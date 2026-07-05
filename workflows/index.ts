import { chronologyBuiltIn } from "./chronology.workflow";
import { eminentDomainCaseAssessmentBuiltIn } from "./eminent-domain-case-assessment.workflow";
import { workflowBuilderBuiltIn } from "./workflow-builder.workflow";

export const builtInWorkflows = [
  chronologyBuiltIn,
  eminentDomainCaseAssessmentBuiltIn,
  workflowBuilderBuiltIn,
];

export { chronologyDefinition } from "./chronology.workflow";
export { eminentDomainCaseAssessmentDefinition } from "./eminent-domain-case-assessment.workflow";
export { workflowBuilderDefinition } from "./workflow-builder.workflow";
