import type { FactDef, FactFieldMergePolicy } from "../../fact-def";
import { createFactExtractionProfile } from "../../generic-fact-profile";
import {
  validateEminentDomainMatterEntity,
  validateEminentDomainEvent,
  validateEminentDomainPropertyImpact,
  validateEminentDomainPropertyInterest,
  validateEminentDomainValuation,
} from "./validators";

export const EMINENT_DOMAIN_MATTER_ENTITY_TYPES = [
  "property-owner",
  "condemning-authority",
  "project",
] as const;

export const EMINENT_DOMAIN_PROPERTY_INTEREST_TYPES = [
  "subject-property",
  "fee-simple",
  "temporary-construction-easement",
  "permanent-easement",
  "access-easement",
  "drainage-easement",
  "utility-easement",
  "other",
] as const;

export const EMINENT_DOMAIN_VALUATION_TYPES = [
  "initial-offer",
  "final-offer",
  "condemnor-appraisal",
  "owner-appraisal",
  "other",
] as const;

export const EMINENT_DOMAIN_EVENT_TYPES = [
  "initial-offer-issued",
  "landowner-bill-of-rights-sent",
  "appraisal-completed",
  "final-offer-issued",
  "owner-response",
  "petition-filed",
  "service-completed",
  "commissioners-appointed",
  "hearing-notice-issued",
  "hearing-scheduled",
  "exhibit-deadline",
  "award-issued",
  "objection-filed",
  "possession-granted",
  "settlement-reached",
  "other",
] as const;

export const EMINENT_DOMAIN_PROPERTY_IMPACT_SOURCE_ROLES = [
  "owner",
  "condemnor",
  "appraiser",
  "engineer",
  "court",
  "counsel",
  "tenant",
  "witness",
  "intake",
  "other",
] as const;

export const eminentDomainFactDefs = [
  {
    description: "A principal entity that identifies the matter.",
    extraction: {
      fields: [
        {
          enumValues: [...EMINENT_DOMAIN_MATTER_ENTITY_TYPES],
          name: "entityType",
          normalizer: "lowercase",
          required: true,
          type: "enum",
        },
        {
          description: "Entity name exactly as identified in the source.",
          name: "name",
          normalizer: "organization-name",
          required: true,
          type: "string",
        },
        { name: "department", normalizer: "organization-name", required: false, type: "string" },
        { name: "projectNumber", normalizer: "project-name", required: false, type: "string" },
      ],
      instructions: [
        "Extract a MATTER_ENTITY fact only for a property owner, condemning authority, or project explicitly identified in the source.",
        "Use property-owner for the legal owner of the subject property.",
        "Use condemning-authority for the public entity or agency pursuing the taking.",
        "Use project for the public project connected to the taking.",
        "Do not emit placeholder names such as unknown, owner not named, not stated, or unavailable.",
        "Include department only when separately stated for the condemning authority.",
        "Include projectNumber only for project entities when explicitly stated.",
      ].join(" "),
    },
    factType: "MATTER_ENTITY",
    identity: {
      mergeRules: {
        fieldPolicies: {
          department: "set",
          entityType: "identity",
          name: "identity",
          projectNumber: "conflict",
        } as Record<string, FactFieldMergePolicy>,
        rejectOnConflictFields: ["projectNumber"],
      },
      rules: [
        {
          action: "merge",
          fields: ["entityType", "name"],
        },
      ],
      scope: "matter",
      strategy: "multiKey",
    },
    validate: validateEminentDomainMatterEntity,
  },
  {
    description: "The subject property or one distinct property interest affected by the taking.",
    extraction: {
      fields: [
        {
          enumValues: [...EMINENT_DOMAIN_PROPERTY_INTEREST_TYPES],
          name: "interestType",
          normalizer: "lowercase",
          required: true,
          type: "enum",
        },
        { name: "parcelNumber", normalizer: "parcel-number", required: false, type: "string" },
        { name: "address", normalizer: "postal-address", required: false, type: "string" },
        { name: "county", normalizer: "lowercase", required: false, type: "string" },
        {
          enumValues: ["total", "partial"],
          name: "takingScope",
          normalizer: "lowercase",
          required: false,
          type: "enum",
        },
        {
          description:
            "Area of the property or property interest represented by this fact. For subject-property, this is the tract area; for fee-simple or easement facts, this is the area of that acquired interest.",
          name: "area",
          normalizer: "acreage",
          required: false,
          type: "string",
        },
        {
          description:
            "Area of the remaining property after the acquisition, when explicitly stated. Normally used only with subject-property.",
          name: "remainderArea",
          normalizer: "acreage",
          required: false,
          type: "string",
        },
        {
          description:
            "Stated purpose of this specific acquired interest, such as roadway widening, grading, driveway reconstruction, staging, drainage, utilities, or construction access.",
          name: "purpose",
          normalizer: "description-text",
          required: false,
          type: "string",
        },
      ],
      instructions: [
        "Extract one PROPERTY_INTEREST fact for the subject property or for each distinct property interest being acquired or imposed.",
        "Use subject-property for the underlying parcel or tract.",
        "Use a specific property-interest category for fee acquisitions and easements.",
        "area means the area of the represented fact.",
        "remainderArea normally belongs on subject-property.",
        "Do not duplicate the same acreage across multiple property interests unless the source actually states it for each.",
        "A source stating a 0.84-acre fee acquisition and a 0.22-acre temporary construction easement should produce two facts with their respective areas.",
        "Do not emit generic phrases such as disputed taking, proposed taking, condemnation matter, acquisition, or property acquisition as an interest type or substantive value.",
        "When a source states both a fee acquisition and a temporary construction easement, emit separate PROPERTY_INTEREST facts.",
        "Do not infer an area, address, county, parcel number, remainder area, scope, or purpose when it is not stated.",
        "Do not use impact-only language, follow-up tasks, document requests, or investigation instructions as PROPERTY_INTEREST facts.",
      ].join(" "),
    },
    factType: "PROPERTY_INTEREST",
    identity: {
      mergeRules: {
        fieldPolicies: {
          address: "conflict",
          area: "conflict",
          county: "conflict",
          interestType: "identity",
          parcelNumber: "identity",
          purpose: "narrative",
          remainderArea: "conflict",
          takingScope: "conflict",
        } as Record<string, FactFieldMergePolicy>,
      },
      rules: [
        {
          action: "merge",
          fields: ["interestType", "parcelNumber"],
        },
        {
          action: "mergeWhenUnique",
          fields: ["interestType", "address", "county"],
          uniqueAgainst: ["parcelNumber"],
        },
      ],
      scope: "matter",
      strategy: "multiKey",
    },
    validate: validateEminentDomainPropertyInterest,
  },
  {
    description: "One written offer or appraisal valuation opinion.",
    extraction: {
      fields: [
        {
          enumValues: [...EMINENT_DOMAIN_VALUATION_TYPES],
          name: "valuationType",
          normalizer: "lowercase",
          required: true,
          type: "enum",
        },
        {
          description: "Date of the written offer. Use only for initial-offer or final-offer facts.",
          name: "offerDate",
          normalizer: "date",
          required: false,
          type: "date",
        },
        { name: "responseDeadline", normalizer: "date", required: false, type: "date" },
        { name: "amount", normalizer: "currency", required: false, type: "string" },
        { name: "appraiser", normalizer: "organization-name", required: false, type: "string" },
        { name: "effectiveDate", normalizer: "date", required: false, type: "date" },
        { name: "reportDate", normalizer: "date", required: false, type: "date" },
        { name: "parcelNumber", normalizer: "parcel-number", required: false, type: "string" },
        { name: "partTakenValue", normalizer: "currency", required: false, type: "string" },
        { name: "remainderDamages", normalizer: "currency", required: false, type: "string" },
        { name: "temporaryDamages", normalizer: "currency", required: false, type: "string" },
        { name: "costToCure", normalizer: "currency", required: false, type: "string" },
      ],
      instructions: [
        "Extract a VALUATION fact for each distinct written offer or appraisal opinion stated in the source.",
        "Use initial-offer for an initial written offer and final-offer for a final written offer.",
        "Offer valuation facts require a stated amount. If a source says only that an offer was sent but does not state the amount, emit an EVENT fact instead of VALUATION.",
        "Use offerDate only for initial-offer or final-offer facts.",
        "Use condemnor-appraisal for a condemnor valuation opinion and owner-appraisal for an owner valuation opinion.",
        "Use other only when no listed category applies.",
        "Keep all components of one appraisal together in one fact.",
        "Do not emit separate facts for total value, part-taken value, remainder damages, temporary damages, and cost to cure when they belong to the same appraisal.",
        "Do not decide which valuation is correct.",
        "Do not emit an appraisal merely because the source states that an appraisal may be prepared in the future.",
        "A written offer or completed appraisal may produce both a VALUATION fact and a corresponding EVENT fact. VALUATION captures the amount and valuation components; EVENT captures the procedural timeline. Do not omit one solely because the other is emitted.",
      ].join(" "),
    },
    factType: "VALUATION",
    identity: {
      mergeRules: {
        fieldPolicies: {
          amount: "conflict",
          appraiser: "conflict",
          costToCure: "conflict",
          effectiveDate: "conflict",
          offerDate: "identity",
          parcelNumber: "identity",
          partTakenValue: "conflict",
          remainderDamages: "conflict",
          reportDate: "conflict",
          responseDeadline: "conflict",
          temporaryDamages: "conflict",
          valuationType: "identity",
        } as Record<string, FactFieldMergePolicy>,
      },
      rules: [
        {
          action: "merge",
          fields: ["valuationType", "offerDate", "parcelNumber"],
          when: {
            valuationType: "initial-offer",
          },
        },
        {
          action: "merge",
          fields: ["valuationType", "offerDate", "parcelNumber"],
          when: {
            valuationType: "final-offer",
          },
        },
        {
          action: "mergeWhenUnique",
          fields: ["valuationType", "offerDate"],
          uniqueAgainst: ["parcelNumber"],
          when: {
            valuationType: "initial-offer",
          },
        },
        {
          action: "mergeWhenUnique",
          fields: ["valuationType", "offerDate"],
          uniqueAgainst: ["parcelNumber"],
          when: {
            valuationType: "final-offer",
          },
        },
        {
          action: "merge",
          fields: ["valuationType", "appraiser", "effectiveDate", "parcelNumber"],
          when: {
            valuationType: "condemnor-appraisal",
          },
        },
        {
          action: "merge",
          fields: ["valuationType", "appraiser", "effectiveDate", "parcelNumber"],
          when: {
            valuationType: "owner-appraisal",
          },
        },
        {
          action: "mergeWhenUnique",
          fields: ["valuationType", "reportDate", "parcelNumber"],
          uniqueAgainst: ["appraiser", "effectiveDate"],
          when: {
            valuationType: "condemnor-appraisal",
          },
        },
        {
          action: "mergeWhenUnique",
          fields: ["valuationType", "reportDate", "parcelNumber"],
          uniqueAgainst: ["appraiser", "effectiveDate"],
          when: {
            valuationType: "owner-appraisal",
          },
        },
      ],
      scope: "matter",
      strategy: "multiKey",
    },
    validate: validateEminentDomainValuation,
  },
  {
    description: "A dated or undated procedural event, notice, request, response, hearing, or deadline.",
    extraction: {
      fields: [
        {
          enumValues: [...EMINENT_DOMAIN_EVENT_TYPES],
          name: "eventType",
          normalizer: "lowercase",
          required: true,
          type: "enum",
        },
        { name: "eventDate", normalizer: "date", required: false, type: "date" },
        { name: "deadline", normalizer: "date", required: false, type: "date" },
        { name: "description", normalizer: "description-text", required: true, type: "string" },
        { name: "parcelNumber", normalizer: "parcel-number", required: false, type: "string" },
      ],
      instructions: [
        "Extract procedural events explicitly stated in the source.",
        "Use the closest declared eventType.",
        "Use eventDate for the date the event occurred or is scheduled to occur.",
        "Use deadline only for a response, exhibit, filing, or other stated deadline associated with the event.",
        "Keep description concise and source-specific.",
        "Do not assess legal risk.",
        "A written offer or completed appraisal may produce both an EVENT fact and a corresponding VALUATION fact because they serve different downstream purposes.",
        "Do not create multiple facts merely to restate the same event in different wording within the same source passage.",
      ].join(" "),
    },
    factType: "EVENT",
    identity: {
      mergeRules: {
        fieldPolicies: {
          deadline: "conflict",
          description: "narrative",
          eventDate: "identity",
          eventType: "identity",
          parcelNumber: "identity",
        } as Record<string, FactFieldMergePolicy>,
      },
      rules: [
        {
          action: "merge",
          fields: ["eventType", "eventDate", "parcelNumber"],
        },
        {
          action: "mergeWhenUnique",
          fields: ["eventType", "eventDate"],
          uniqueAgainst: ["parcelNumber"],
        },
      ],
      scope: "matter",
      strategy: "multiKey",
    },
    validate: validateEminentDomainEvent,
  },
  {
    description:
      "A concrete physical, operational, tenant, access, parking, or construction impact affecting the property or remainder.",
    extraction: {
      fields: [
        {
          enumValues: [
            "access",
            "parking",
            "truck-circulation",
            "tenant",
            "signage",
            "construction",
            "drainage",
            "other",
          ],
          name: "category",
          normalizer: "lowercase",
          required: true,
          type: "enum",
        },
        { name: "description", normalizer: "description-text", required: true, type: "string" },
        { name: "affectedFeature", normalizer: "affected-feature", required: false, type: "string" },
        {
          enumValues: ["confirmed", "alleged", "anticipated", "assumed"],
          name: "assertionStatus",
          normalizer: "lowercase",
          required: false,
          type: "enum",
        },
        {
          enumValues: [...EMINENT_DOMAIN_PROPERTY_IMPACT_SOURCE_ROLES],
          name: "sourceRole",
          normalizer: "lowercase",
          required: false,
          type: "enum",
        },
        { name: "sourceName", normalizer: "organization-name", required: false, type: "string" },
        {
          enumValues: ["temporary", "permanent", "unknown"],
          name: "duration",
          normalizer: "lowercase",
          required: false,
          type: "enum",
        },
        { name: "quantifiedImpact", normalizer: "description-text", required: false, type: "string" },
        { name: "parcelNumber", normalizer: "parcel-number", required: false, type: "string" },
      ],
      instructions: [
        "Extract concrete stated physical, operational, tenant, access, parking, signage, drainage, or construction impacts affecting the property or remainder.",
        "Do not extract follow-up tasks, requests, investigation instructions, document requests, collection instructions, or recommendations as PROPERTY_IMPACT facts.",
        "Do not extract abstract appraisal deficiencies or valuation gaps as PROPERTY_IMPACT facts.",
        "For example, do not emit a PROPERTY_IMPACT fact from: Confirm whether the appraisal accounts for parking loss; Request the traffic-control plan; Collect photographs of driveway usage.",
        "Extract only the underlying impact when the source actually states one.",
        "Use alleged when a disputing party, owner, tenant, witness, or counsel asserts an impact, even when the impact is expected in the future.",
        "Use assumed when an appraisal, engineering analysis, or other expert analysis expressly relies on the proposition as an assumption.",
        "Use confirmed when operative plans, orders, measurements, or completed conditions establish the impact.",
        "Use anticipated for neutral projected or expected impacts not presented as a disputed party assertion or analytical assumption.",
        "If status is unclear, omit assertionStatus.",
        "Use a concise affectedFeature noun phrase.",
        "Do not add legal conclusions.",
      ].join(" "),
    },
    factType: "PROPERTY_IMPACT",
    identity: {
      mergeRules: {
        fieldPolicies: {
          affectedFeature: "identity",
          assertionStatus: "set",
          category: "identity",
          description: "narrative",
          duration: "conflict",
          parcelNumber: "identity",
          quantifiedImpact: "conflict",
          sourceName: "set",
          sourceRole: "set",
        } as Record<string, FactFieldMergePolicy>,
      },
      rules: [
        {
          action: "merge",
          fields: ["category", "affectedFeature", "parcelNumber"],
        },
        {
          action: "mergeWhenUnique",
          fields: ["category", "affectedFeature"],
          uniqueAgainst: ["parcelNumber"],
        },
      ],
      scope: "matter",
      strategy: "multiKey",
    },
    validate: validateEminentDomainPropertyImpact,
  },
] satisfies FactDef[];

export const eminentDomainFactsProfile = createFactExtractionProfile({
  description:
    "Extract core parties, property interests, valuations, procedural events, and property impacts from eminent-domain documents.",
  factDefs: eminentDomainFactDefs,
  id: "eminent-domain-facts",
  itemLabel: "fact",
  itemPluralLabel: "facts",
  label: "Eminent Domain Facts",
  maxOutputTokens: 8000,
  profileInstructions: [
    "Extract raw eminent domain facts for lawyer review.",
    "For extractionConfidence, report confidence that the source document states the extracted proposition. Do not use extractionConfidence to express whether the proposition is ultimately true or undisputed across the matter.",
    "Do not generate matter overviews, procedural flags, missing-document conclusions, valuation gaps, recommendations, next actions, follow-up task facts, or document-reference facts.",
    "Extract only core parties, property interests, valuations, procedural events, and concrete property impacts.",
  ].join("\n"),
  taskId: "eminent-domain-facts",
  ui: {
    profileLine: null,
    retryButtonLabel: "Retry extraction",
    runButtonLabel: "Extract case facts",
    runningButtonLabel: "Extracting...",
    runningDocumentLabel: "Extracting",
  },
});
