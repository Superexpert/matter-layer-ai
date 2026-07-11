import { chronologyExtractionProfile } from "./chronology";
import { eminentDomainFactsProfile } from "./eminent-domain";
import { condemnorAppraisalExtractionProfile } from "./appraisal";
import type { ExtractionProfile } from "../types";

export const extractionProfiles: Record<string, ExtractionProfile<unknown>> = {
  chronology: chronologyExtractionProfile as ExtractionProfile<unknown>,
  "condemnor-appraisal-review": condemnorAppraisalExtractionProfile as ExtractionProfile<unknown>,
  "eminent-domain-facts":
    eminentDomainFactsProfile as ExtractionProfile<unknown>,
  // Legacy alias for persisted workflow step configs created before the raw fact profile rename.
  "eminent-domain-case-assessment":
    eminentDomainFactsProfile as ExtractionProfile<unknown>,
};

export function getExtractionProfile(profileId: string) {
  const profile = extractionProfiles[profileId as keyof typeof extractionProfiles];

  if (!profile) {
    throw new Error(`Unsupported extraction profile: ${profileId}`);
  }

  return profile;
}
