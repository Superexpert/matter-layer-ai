import type { FactDef, FactFieldDef } from "./fact-def";

const confidenceSchema = {
  enum: ["high", "medium", "low", null],
  type: ["string", "null"],
};

function fieldJsonType(field: FactFieldDef): Record<string, unknown> {
  const description = field.description ? { description: field.description } : {};

  if (field.type === "enum") {
    if (!field.enumValues?.length) {
      throw new Error(`Enum fact field ${field.name} must declare enumValues.`);
    }

    return {
      ...description,
      enum: field.required ? field.enumValues : [...field.enumValues, null],
      type: field.required ? "string" : ["string", "null"],
    };
  }

  if (field.type === "number") {
    return {
      ...description,
      type: field.required ? "number" : ["number", "null"],
    };
  }

  if (field.type === "boolean") {
    return {
      ...description,
      type: field.required ? "boolean" : ["boolean", "null"],
    };
  }

  return {
    ...description,
    type: field.required ? "string" : ["string", "null"],
  };
}

function fieldsSchema(factDef: FactDef) {
  const properties = Object.fromEntries(
    factDef.extraction.fields.map((field) => [field.name, fieldJsonType(field)]),
  );

  return {
    additionalProperties: false,
    properties,
    // OpenAI strict JSON schema requires every object property to appear in
    // required. Optional fact fields are represented as nullable in the schema;
    // runtime validation also accepts them when omitted.
    required: Object.keys(properties),
    type: "object",
  };
}

function factVariantSchema(factDef: FactDef) {
  return {
    additionalProperties: false,
    properties: {
      extractionConfidence: confidenceSchema,
      factType: {
        const: factDef.factType,
        type: "string",
      },
      fields: fieldsSchema(factDef),
      pageEnd: {
        type: ["number", "null"],
      },
      pageStart: {
        type: ["number", "null"],
      },
      sourceExcerpt: {
        type: ["string", "null"],
      },
    },
    required: [
      "factType",
      "fields",
      "extractionConfidence",
      "sourceExcerpt",
      "pageStart",
      "pageEnd",
    ],
    type: "object",
  };
}

export function buildFactExtractionResponseSchema(factDefs: FactDef[]) {
  if (factDefs.length === 0) {
    throw new Error("Extraction profile must declare at least one fact definition.");
  }

  const duplicateFactTypes = factDefs
    .map((factDef) => factDef.factType)
    .filter((factType, index, factTypes) => factTypes.indexOf(factType) !== index);

  if (duplicateFactTypes.length > 0) {
    throw new Error(`Duplicate fact definitions: ${[...new Set(duplicateFactTypes)].join(", ")}`);
  }

  return {
    additionalProperties: false,
    properties: {
      facts: {
        items: {
          anyOf: factDefs.map(factVariantSchema),
        },
        type: "array",
      },
    },
    required: ["facts"],
    type: "object",
  } satisfies Record<string, unknown>;
}

export function factExtractionJsonRepairInstructions(factDefs: FactDef[]) {
  return [
    "Return a JSON object with exactly this top-level shape:",
    "{\"facts\":[{\"factType\":\"FACT_TYPE\",\"fields\":{},\"extractionConfidence\":\"high|medium|low|null\",\"sourceExcerpt\":\"short verbatim excerpt|null\",\"pageStart\":1,\"pageEnd\":1}]}",
    `Supported factType values: ${factDefs.map((factDef) => factDef.factType).join(", ")}.`,
    "Each fields object must contain only fields declared for that factType.",
    "Use null for optional fields requested by the schema when the document does not state a value.",
    "Omit unsupported facts instead of emitting placeholder values.",
  ].join("\n");
}
