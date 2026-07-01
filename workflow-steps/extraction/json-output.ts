function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripJsonFence(value: string) {
  const trimmedValue = value.trim();
  const fencedJsonMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmedValue);

  return fencedJsonMatch ? fencedJsonMatch[1].trim() : trimmedValue;
}

export function parseJsonModelOutput(value: string): unknown {
  try {
    return JSON.parse(stripJsonFence(value));
  } catch {
    throw new Error("Extraction response must be valid JSON.");
  }
}

export function extractModelOutputItems(input: {
  content: string;
  itemKeys: string[];
}) {
  const parsed = parseJsonModelOutput(input.content);

  if (Array.isArray(parsed)) {
    return {
      items: parsed,
      raw: parsed,
    };
  }

  if (!isObjectRecord(parsed)) {
    throw new Error("Extraction response must be a JSON object or array.");
  }

  for (const itemKey of input.itemKeys) {
    const value = parsed[itemKey];

    if (Array.isArray(value)) {
      return {
        items: value,
        raw: parsed,
      };
    }
  }

  throw new Error(
    `Extraction response must include one of these array fields: ${input.itemKeys.join(", ")}.`,
  );
}
