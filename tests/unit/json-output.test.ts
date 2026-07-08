import { describe, expect, it } from "vitest";

import {
  extractModelOutputItems,
  JsonModelOutputParseError,
  parseJsonModelOutput,
} from "../../workflow-steps/extraction/json-output";

describe("JSON model output parsing", () => {
  it("parses pure JSON", () => {
    expect(parseJsonModelOutput("{\"facts\":[]}")).toEqual({
      facts: [],
    });
  });

  it("parses JSON inside Markdown code fences", () => {
    expect(parseJsonModelOutput("```json\n{\"facts\":[]}\n```")).toEqual({
      facts: [],
    });
  });

  it("parses JSON with prose before and after it", () => {
    expect(
      parseJsonModelOutput("Here is the extraction:\n{\"facts\":[]}\nDone."),
    ).toEqual({
      facts: [],
    });
  });

  it("throws a diagnostic parse error for invalid JSON", () => {
    expect(() => parseJsonModelOutput("Here is JSON: {\"facts\":[")).toThrow(
      JsonModelOutputParseError,
    );

    try {
      parseJsonModelOutput("Here is JSON: {\"facts\":[");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonModelOutputParseError);
      expect((error as JsonModelOutputParseError).diagnostics).toMatchObject({
        hadProseBeforeJson: true,
        isLikelyTruncated: true,
      });
    }
  });

  it("throws for schema-invalid JSON without weakening parser behavior", () => {
    expect(() =>
      extractModelOutputItems({
        content: "{\"events\":[]}",
        itemKeys: ["facts"],
      }),
    ).toThrow("Extraction response must include one of these array fields: facts.");
  });
});
