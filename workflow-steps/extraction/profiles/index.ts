import { chronologyExtractionProfile } from "./chronology";

export const extractionProfiles = {
  chronology: chronologyExtractionProfile,
} as const;

export function getExtractionProfile(profileId: string) {
  const profile = extractionProfiles[profileId as keyof typeof extractionProfiles];

  if (!profile) {
    throw new Error(`Unsupported extraction profile: ${profileId}`);
  }

  return profile;
}
