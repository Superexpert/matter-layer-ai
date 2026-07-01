import { chronologyExtractionProfile } from "./chronology";
import type { ExtractionProfile } from "../types";

export const extractionProfiles: Record<string, ExtractionProfile<unknown>> = {
  chronology: chronologyExtractionProfile as ExtractionProfile<unknown>,
};

export function getExtractionProfile(profileId: string) {
  const profile = extractionProfiles[profileId as keyof typeof extractionProfiles];

  if (!profile) {
    throw new Error(`Unsupported extraction profile: ${profileId}`);
  }

  return profile;
}
