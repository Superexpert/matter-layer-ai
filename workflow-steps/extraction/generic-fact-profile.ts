import { randomUUID } from "node:crypto";

import {
  logCollapsedFacts,
  logRejectedExtractedFact,
  verboseExtractionLog,
} from "@/services/diagnostics/verbose-logging";

import type {
  ExtractionMarkdownWindow,
  ExtractionProfile,
  ExtractionWarning,
} from "./types";
import { documentMetadataPromptBlock } from "./document-metadata";
import { extractModelOutputItems } from "./json-output";
import type { ExtractedFact, ExtractedFactConfidence } from "./extracted-fact";
import type { FactDef, FactFieldDef } from "./fact-def";
import {
  buildFactExtractionResponseSchema,
  factExtractionJsonRepairInstructions,
} from "./fact-schema-builder";
import { collapseExtractedFacts } from "./identity";

const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

const PLACEHOLDER_VALUE_PATTERNS = [
  /^unknown$/i,
  /^not (?:named|stated|provided|available)$/i,
  /^unavailable$/i,
  /^none provided$/i,
  /^n\/a$/i,
  /^owner not named$/i,
];

const PAGE_MARKER_AT_INDEX_PATTERN = /^<!--\s*ml:page\s+{[^>]+}\s*-->/;

export const COMMON_FACT_EXTRACTION_INSTRUCTIONS = [
  "Extract only facts explicitly supported by the source document.",
  "Do not use outside knowledge.",
  "Do not infer a value merely because it would normally be expected.",
  "Do not emit placeholder values such as unknown, not named, not stated, unavailable, or none provided.",
  "When a fact is not stated, omit the fact.",
  "Return each distinct supported fact as a typed fact matching one of the supplied fact definitions.",
  "Include a short verbatim source excerpt supporting each fact.",
  "Return one raw JSON object only. Do not include Markdown fences, prose, or commentary.",
].join("\n");

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPlaceholderString(value: string) {
  const trimmedValue = value.trim();

  return PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(trimmedValue));
}

function requireString(value: unknown, fieldLabel: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldLabel} must be a non-empty string.`);
  }

  const trimmedValue = value.trim();

  if (isPlaceholderString(trimmedValue)) {
    throw new Error(`${fieldLabel} must not be a placeholder value: ${trimmedValue}`);
  }

  return trimmedValue;
}

function optionalString(value: unknown, fieldLabel: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireString(value, fieldLabel);
}

function validateFieldValue(field: FactFieldDef, value: unknown) {
  if (value === undefined || value === null) {
    if (field.required) {
      throw new Error(`Fact field ${field.name} is required.`);
    }

    return undefined;
  }

  if (!field.required && typeof value === "string" && !value.trim()) {
    return undefined;
  }

  if (field.type === "string" || field.type === "date") {
    return requireString(value, `Fact field ${field.name}`);
  }

  if (field.type === "enum") {
    const stringValue = requireString(value, `Fact field ${field.name}`);
    if (!field.enumValues?.includes(stringValue)) {
      throw new Error(
        `Fact field ${field.name} must be one of: ${(field.enumValues ?? []).join(", ")}.`,
      );
    }

    return stringValue;
  }

  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Fact field ${field.name} must be a finite number.`);
    }

    return value;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Fact field ${field.name} must be a boolean.`);
  }

  return value;
}

function validateFields(input: {
  factDef: FactDef;
  rawFields: unknown;
  window: ExtractionMarkdownWindow;
}) {
  if (!isObjectRecord(input.rawFields)) {
    throw new Error(`Fact ${input.factDef.factType} fields must be an object.`);
  }

  const fieldDefsByName = new Map(
    input.factDef.extraction.fields.map((field) => [field.name, field]),
  );
  const unsupportedFields = Object.keys(input.rawFields).filter(
    (fieldName) => !fieldDefsByName.has(fieldName),
  );

  if (unsupportedFields.length > 0) {
    throw new Error(
      `Fact ${input.factDef.factType} included unsupported fields: ${unsupportedFields.join(", ")}.`,
    );
  }

  const fields: Record<string, unknown> = {};

  for (const fieldDef of input.factDef.extraction.fields) {
    const value = validateFieldValue(fieldDef, input.rawFields[fieldDef.name]);

    if (value !== undefined) {
      fields[fieldDef.name] = value;
    }
  }

  return input.factDef.validate
    ? input.factDef.validate(fields, {
        window: input.window,
      })
    : fields;
}

function optionalPage(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive page number.`);
  }

  return value;
}

function extractionConfidence(value: unknown): ExtractedFactConfidence | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !CONFIDENCE_VALUES.includes(value as ExtractedFactConfidence)) {
    throw new Error("Fact extractionConfidence must be high, medium, or low.");
  }

  return value as ExtractedFactConfidence;
}

function normalizedWhitespaceMatch(input: {
  haystack: string;
  needle: string;
}) {
  const normalizedHaystack: string[] = [];
  const originalIndexes: number[] = [];
  let previousWasWhitespace = false;

  for (let index = 0; index < input.haystack.length; index += 1) {
    const markerMatch = input.haystack.slice(index).match(PAGE_MARKER_AT_INDEX_PATTERN);

    if (markerMatch) {
      if (!previousWasWhitespace) {
        normalizedHaystack.push(" ");
        originalIndexes.push(index);
        previousWasWhitespace = true;
      }
      index += markerMatch[0].length - 1;
      continue;
    }

    const character = input.haystack[index]!;

    if (/\s/.test(character)) {
      if (!previousWasWhitespace) {
        normalizedHaystack.push(" ");
        originalIndexes.push(index);
        previousWasWhitespace = true;
      }
      continue;
    }

    normalizedHaystack.push(character);
    originalIndexes.push(index);
    previousWasWhitespace = false;
  }

  const normalizedNeedle = input.needle.trim().replace(/\s+/g, " ");
  const start = normalizedHaystack.join("").indexOf(normalizedNeedle);

  if (start < 0) {
    return null;
  }

  const end = start + normalizedNeedle.length - 1;
  const originalStart = originalIndexes[start];
  const originalEnd = originalIndexes[end];

  if (originalStart === undefined || originalEnd === undefined) {
    return null;
  }

  return {
    end: originalEnd + 1,
    start: originalStart,
  };
}

function exactOrNormalizedExcerptRange(input: {
  excerpt: string;
  markdown: string;
}) {
  const exactStart = input.markdown.indexOf(input.excerpt);

  if (exactStart >= 0) {
    return {
      end: exactStart + input.excerpt.length,
      start: exactStart,
    };
  }

  return normalizedWhitespaceMatch({
    haystack: input.markdown,
    needle: input.excerpt,
  });
}

function pageRangeForCharacterRange(input: {
  end: number;
  pageSegments?: ExtractionMarkdownWindow["pageSegments"];
  start: number;
}) {
  const segments = input.pageSegments ?? [];
  const overlappingPages = segments
    .filter((segment) =>
      input.start < segment.textEnd && input.end > segment.textStart,
    )
    .map((segment) => segment.page);

  if (overlappingPages.length === 0) {
    return null;
  }

  return {
    pageEnd: Math.max(...overlappingPages),
    pageStart: Math.min(...overlappingPages),
  };
}

function resolveEvidencePageRange(input: {
  excerpt?: string;
  rawPageEnd?: number;
  rawPageStart?: number;
  window: ExtractionMarkdownWindow;
}) {
  if (input.excerpt && input.window.pageSegments?.length) {
    const range = exactOrNormalizedExcerptRange({
      excerpt: input.excerpt,
      markdown: input.window.markdown,
    });

    if (range) {
      const pageRange = pageRangeForCharacterRange({
        end: range.end,
        pageSegments: input.window.pageSegments,
        start: range.start,
      });

      if (pageRange) {
        return pageRange;
      }
    }
  }

  const pageStart = input.rawPageStart ?? input.window.pageStart ?? undefined;
  const pageEnd = input.rawPageEnd ?? input.window.pageEnd ?? pageStart;

  return {
    pageEnd,
    pageStart,
  };
}

export function validateAndAttachFactProvenance(input: {
  factDefs: FactDef[];
  rawFact: unknown;
  window: ExtractionMarkdownWindow;
}): ExtractedFact {
  if (!isObjectRecord(input.rawFact)) {
    throw new Error("Extracted fact must be an object.");
  }

  const factType = requireString(input.rawFact.factType, "Fact factType");
  const factDef = input.factDefs.find((candidate) => candidate.factType === factType);

  if (!factDef) {
    throw new Error(`Unsupported fact type: ${factType}`);
  }

  const excerpt = optionalString(input.rawFact.sourceExcerpt, "Fact sourceExcerpt");
  const pageRange = resolveEvidencePageRange({
    excerpt,
    rawPageEnd: optionalPage(input.rawFact.pageEnd, "pageEnd"),
    rawPageStart: optionalPage(input.rawFact.pageStart, "pageStart"),
    window: input.window,
  });

  return {
    evidence: {
      documentDate: input.window.documentMetadata?.documentDate,
      documentDateSource: input.window.documentMetadata?.documentDateSource,
      documentId: input.window.documentId,
      documentName: input.window.fileName,
      excerpt,
      pageEnd: pageRange.pageEnd,
      pageStart: pageRange.pageStart,
    },
    extractionConfidence: extractionConfidence(input.rawFact.extractionConfidence),
    factType,
    fields: validateFields({
      factDef,
      rawFields: input.rawFact.fields,
      window: input.window,
    }),
    id: typeof input.rawFact.id === "string" && input.rawFact.id.trim()
      ? input.rawFact.id.trim()
      : randomUUID(),
  };
}

export function parseFactExtractionOutput(input: {
  content: string;
  factDefs: FactDef[];
  window: ExtractionMarkdownWindow;
}) {
  const parsed = extractModelOutputItems({
    content: input.content,
    itemKeys: ["facts"],
  });
  const warnings: ExtractionWarning[] = [];
  const facts = parsed.items.flatMap((rawFact, index) => {
    try {
      return [
        validateAndAttachFactProvenance({
          factDefs: input.factDefs,
          rawFact,
          window: input.window,
        }),
      ];
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Fact failed validation.";
      logRejectedExtractedFact({
        candidate: rawFact,
        documentName: input.window.fileName,
        factType:
          isObjectRecord(rawFact) && typeof rawFact.factType === "string"
            ? rawFact.factType
            : undefined,
        reason: message,
        windowCount: undefined,
        windowIndex: input.window.windowIndex + 1,
      });
      warnings.push({
        code: "rejected_extracted_fact",
        itemId: String(index),
        message,
        rawValue: rawFact,
        severity: "warning",
      });
      return [];
    }
  });

  if (facts.length === 0 && parsed.items.length > 0) {
    throw new Error(
      `No usable facts were extracted. ${warnings[0]?.message ?? ""}`.trim(),
    );
  }

  return {
    facts,
    warnings,
  };
}

function factDefinitionsPrompt(factDefs: FactDef[]) {
  return factDefs.map((factDef) => {
    const fields = factDef.extraction.fields.map((field) => {
      const typeLabel = field.type === "enum"
        ? `enum(${field.enumValues?.join(" | ")})`
        : field.type;

      return [
        `  - ${field.name}: ${typeLabel}${field.required ? " required" : " optional"}`,
        field.description ? `    ${field.description}` : null,
      ].filter(Boolean).join("\n");
    });

    return [
      `Fact type: ${factDef.factType}`,
      factDef.description ? `Description: ${factDef.description}` : null,
      `Instructions: ${factDef.extraction.instructions}`,
      "Fields:",
      ...fields,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function buildFactExtractionUserPrompt(input: {
  factDefs: FactDef[];
  profileInstructions?: string;
  window: ExtractionMarkdownWindow;
}) {
  return [
    input.profileInstructions,
    "Supported fact definitions:",
    factDefinitionsPrompt(input.factDefs),
    "",
    "Return JSON with this exact top-level shape:",
    "{\"facts\":[{\"factType\":\"FACT_TYPE\",\"fields\":{},\"extractionConfidence\":\"high|medium|low|null\",\"sourceExcerpt\":\"short supporting excerpt\",\"pageStart\":1,\"pageEnd\":1}]}",
    "extractionConfidence measures confidence that the source document states the extracted proposition. It does not measure whether the proposition is ultimately true or undisputed in the matter.",
    "Do not wrap the JSON in ``` fences.",
    "",
    `matterDocumentId: ${input.window.documentId}`,
    `sourceFileName: ${input.window.fileName}`,
    input.window.pageStart && input.window.pageEnd
      ? `pageRange: ${input.window.pageStart}-${input.window.pageEnd}`
      : "pageRange: unknown",
    documentMetadataPromptBlock(input.window.documentMetadata),
    "",
    "Source Markdown window:",
    input.window.markdown,
  ].filter(Boolean).join("\n");
}

export function createFactExtractionProfile(input: {
  createWindows?: ExtractionProfile<ExtractedFact>["createWindows"];
  description?: string;
  factDefs: FactDef[];
  id: string;
  itemLabel?: string;
  itemPluralLabel?: string;
  label: string;
  maxOutputTokens?: number;
  postProcess?: ExtractionProfile<ExtractedFact>["postProcess"];
  profileInstructions?: string;
  taskId?: string;
  ui?: ExtractionProfile<ExtractedFact>["ui"];
}): ExtractionProfile<ExtractedFact> & { factDefs: FactDef[] } {
  const responseSchema = buildFactExtractionResponseSchema(input.factDefs);

  return {
    buildUserPrompt: (window) =>
      buildFactExtractionUserPrompt({
        factDefs: input.factDefs,
        profileInstructions: input.profileInstructions,
        window,
      }),
    createWindows: input.createWindows,
    description: input.description ?? input.label,
    factDefs: input.factDefs,
    id: input.id,
    itemLabel: input.itemLabel ?? "fact",
    itemPluralLabel: input.itemPluralLabel ?? "facts",
    jsonRepairInstructions: factExtractionJsonRepairInstructions(input.factDefs),
    label: input.label,
    maxOutputTokens: input.maxOutputTokens,
    parseModelOutput: (content, context) => {
      const parsed = parseFactExtractionOutput({
        content,
        factDefs: input.factDefs,
        window: context.window,
      });

      return {
        itemCountsByType: parsed.facts.reduce<Record<string, number>>(
          (counts, fact) => ({
            ...counts,
            [fact.factType]: (counts[fact.factType] ?? 0) + 1,
          }),
          {},
        ),
        items: parsed.facts,
        warnings: parsed.warnings,
      };
    },
    postProcess: input.postProcess ??
      ((postProcessInput) => {
        const collapseStartedAt = Date.now();
        verboseExtractionLog("[extraction:collapse]", "collapse started", {
          profileId: input.id,
          rawFactCount: postProcessInput.items.length,
        });
        const collapseResult = collapseExtractedFacts({
          factDefs: input.factDefs,
          facts: postProcessInput.items,
          profileId: input.id,
        });
        verboseExtractionLog("[extraction:collapse]", "collapse completed", {
          collapsedFactCount: collapseResult.summary.collapsedFactCount,
          conflictingCount: collapseResult.summary.conflictingCount,
          durationMs: Date.now() - collapseStartedAt,
          profileId: input.id,
          rawFactCount: collapseResult.summary.rawFactCount,
        });
        for (const [factType, counts] of Object.entries(collapseResult.summary.countsByFactType)) {
          verboseExtractionLog("[extraction:collapse]", "fact type completed", {
            collapsedFactCount: counts.collapsed,
            conflictCount: counts.conflicting,
            factType,
            profileId: input.id,
            rawFactCount: counts.raw,
          });
        }
        logCollapsedFacts({
          collapsedFacts: collapseResult.collapsedFacts,
          profileId: input.id,
          summary: collapseResult.summary,
        });
        const documentsById = new Map<string, {
          documentId: string;
          documentName: string;
          facts: ExtractedFact[];
          status: "completed";
          warnings: string[];
        }>();

        for (const fact of postProcessInput.items) {
          const document = documentsById.get(fact.evidence.documentId) ?? {
            documentId: fact.evidence.documentId,
            documentName: fact.evidence.documentName,
            facts: [],
            status: "completed" as const,
            warnings: [],
          };

          document.facts.push(fact);
          documentsById.set(fact.evidence.documentId, document);
        }

        return {
          displayItems: postProcessInput.items.map((fact) => ({ ...fact })),
          itemCount: postProcessInput.items.length,
          itemCountsByType: postProcessInput.runResult.itemCountsByType,
          profileOutput: {
            collapsedFacts: collapseResult.collapsedFacts,
            collapseSummary: collapseResult.summary,
            documents: [...documentsById.values()],
            facts: postProcessInput.items,
            profileId: input.id,
            rawFacts: postProcessInput.items,
          },
          stepOutputPatch: {
            collapsedFacts: collapseResult.collapsedFacts.map((fact) => ({ ...fact })),
            collapseSummary: collapseResult.summary,
            extractedFactCount: postProcessInput.items.length,
            facts: postProcessInput.items.map((fact) => ({ ...fact })),
            factsByType: postProcessInput.runResult.itemCountsByType,
            rawFacts: postProcessInput.items.map((fact) => ({ ...fact })),
          },
        };
      }),
    responseFormat: {
      name: `${input.id.replace(/[^A-Za-z0-9_-]/g, "_")}_facts`,
      schema: responseSchema,
      type: "json_schema",
    },
    systemPrompt: [
      COMMON_FACT_EXTRACTION_INSTRUCTIONS,
    ].join("\n"),
    taskId: input.taskId,
    ui: input.ui,
  };
}
