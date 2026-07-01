function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type JsonModelOutputDiagnostics = {
  candidateCharacterCount: number;
  containsMarkdownFence: boolean;
  hadProseAfterJson: boolean;
  hadProseBeforeJson: boolean;
  isLikelyTruncated: boolean;
  originalCharacterCount: number;
};

export class JsonModelOutputParseError extends Error {
  readonly diagnostics: JsonModelOutputDiagnostics;

  constructor(message: string, diagnostics: JsonModelOutputDiagnostics) {
    super(message);
    this.name = "JsonModelOutputParseError";
    this.diagnostics = diagnostics;
  }
}

function stripWholeJsonFence(value: string) {
  const trimmedValue = value.trim();
  const fencedJsonMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmedValue);

  return fencedJsonMatch ? fencedJsonMatch[1].trim() : trimmedValue;
}

function findJsonCandidate(value: string) {
  const trimmedValue = stripWholeJsonFence(value);
  const firstJsonIndex = trimmedValue.search(/[\[{]/);

  if (firstJsonIndex < 0) {
    return {
      candidate: trimmedValue,
      hadProseAfterJson: false,
      hadProseBeforeJson: Boolean(trimmedValue),
      isLikelyTruncated: false,
    };
  }

  const opener = trimmedValue[firstJsonIndex];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = firstJsonIndex; index < trimmedValue.length; index += 1) {
    const char = trimmedValue[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
    }

    if (depth === 0) {
      return {
        candidate: trimmedValue.slice(firstJsonIndex, index + 1).trim(),
        hadProseAfterJson: Boolean(trimmedValue.slice(index + 1).trim()),
        hadProseBeforeJson: Boolean(trimmedValue.slice(0, firstJsonIndex).trim()),
        isLikelyTruncated: false,
      };
    }
  }

  return {
    candidate: trimmedValue.slice(firstJsonIndex).trim(),
    hadProseAfterJson: false,
    hadProseBeforeJson: Boolean(trimmedValue.slice(0, firstJsonIndex).trim()),
    isLikelyTruncated: true,
  };
}

export function analyzeJsonModelOutput(value: string) {
  const containsMarkdownFence = /```/.test(value);
  const {
    candidate,
    hadProseAfterJson,
    hadProseBeforeJson,
    isLikelyTruncated,
  } = findJsonCandidate(value);

  return {
    candidate,
    diagnostics: {
      candidateCharacterCount: candidate.length,
      containsMarkdownFence,
      hadProseAfterJson,
      hadProseBeforeJson,
      isLikelyTruncated,
      originalCharacterCount: value.length,
    } satisfies JsonModelOutputDiagnostics,
  };
}

export function parseJsonModelOutput(value: string): unknown {
  const { candidate, diagnostics } = analyzeJsonModelOutput(value);

  try {
    return JSON.parse(candidate);
  } catch {
    throw new JsonModelOutputParseError(
      "Extraction response must be valid JSON.",
      diagnostics,
    );
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
