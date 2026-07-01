import { describe, expect, it } from "vitest";

import {
  JsonModelOutputParseError,
  extractModelOutputItems,
} from "../../workflow-steps/extraction/json-output";
import { runExtractionProfile } from "../../workflow-steps/extraction/profile-runner";
import type { ExtractionProfile } from "../../workflow-steps/extraction/types";

type TestIssue = {
  issue: string;
  sourceDocumentId: string;
};

const testIssuesProfile = {
  buildUserPrompt: (window) => `Extract issues from ${window.fileName}.`,
  description: "Extract issue-oriented facts for tests.",
  id: "test-issues",
  itemLabel: "issue",
  itemPluralLabel: "issues",
  label: "Test Issues",
  parseModelOutput: (content) => {
    const parsed = extractModelOutputItems({
      content,
      itemKeys: ["issues"],
    });
    const items = parsed.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Issue item must be an object.");
      }

      const issue = item as Record<string, unknown>;
      if (typeof issue.issue !== "string") {
        throw new Error("Issue item must include issue text.");
      }

      return {
        issue: issue.issue,
        sourceDocumentId:
          typeof issue.sourceDocumentId === "string"
            ? issue.sourceDocumentId
            : "unknown",
      };
    });

    return {
      itemCountsByType: {
        issue: items.length,
      },
      items,
      warnings: [],
    };
  },
  systemPrompt: "Extract issues.",
} satisfies ExtractionProfile<TestIssue>;

describe("generic extraction profile runner", () => {
  it("parses JSON from markdown fences and configured item keys", () => {
    expect(
      extractModelOutputItems({
        content: '```json\n{"issues":[{"issue":"Standing"}]}\n```',
        itemKeys: ["issues"],
      }).items,
    ).toEqual([
      {
        issue: "Standing",
      },
    ]);
  });

  it("parses JSON with prose before and after the JSON object", () => {
    expect(
      extractModelOutputItems({
        content: 'Here is the JSON:\n{"issues":[{"issue":"Standing"}]}\nDone.',
        itemKeys: ["issues"],
      }).items,
    ).toEqual([
      {
        issue: "Standing",
      },
    ]);
  });

  it("distinguishes truncated and syntactically invalid JSON parse failures", () => {
    expect(() =>
      extractModelOutputItems({
        content: '{"issues":[{"issue":"Standing"}]',
        itemKeys: ["issues"],
      }),
    ).toThrow(JsonModelOutputParseError);

    try {
      extractModelOutputItems({
        content: '{"issues":[{"issue": Standing}]}',
        itemKeys: ["issues"],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(JsonModelOutputParseError);
      expect((error as JsonModelOutputParseError).diagnostics).toMatchObject({
        isLikelyTruncated: false,
      });
    }
  });

  it("does not retry valid JSON that fails profile schema validation", async () => {
    let callCount = 0;

    const result = await runExtractionProfile(testIssuesProfile, {
      aiService: {
        generateText: async () => {
          callCount += 1;

          return {
            content: JSON.stringify({
              issues: [
                {
                  sourceDocumentId: "doc_issues",
                },
              ],
            }),
            model: "test-model",
            provider: "test-provider",
          };
        },
      },
      readyDocuments: [
        {
          fileName: "Motion.pdf",
          id: "doc_issues",
          markdown: "The stop lacked reasonable suspicion.",
        },
      ],
    });

    expect(callCount).toBe(1);
    expect(result).toMatchObject({
      errorCode: "AI_PROVIDER_REQUEST_FAILED",
      failedWindowCount: 1,
      status: "FAILED",
    });
    expect(result.error).toContain("Issue item must include issue text.");
  });

  it("retries once with a JSON repair prompt after invalid JSON", async () => {
    const requests: Array<Parameters<typeof testIssuesProfile.parseModelOutput>[0]> = [];
    let callCount = 0;

    const result = await runExtractionProfile(
      {
        ...testIssuesProfile,
        jsonRepairInstructions:
          "{\"issues\":[{\"issue\":\"issue text\",\"sourceDocumentId\":\"document id\"}]}",
        responseFormat: {
          type: "json_object",
        },
      },
      {
        aiService: {
          generateText: async (request) => {
            callCount += 1;
            requests.push(request.messages.at(-1)?.content ?? "");

            return {
              content: callCount === 1
                ? '{"issues":[{"issue":"Standing"}]'
                : JSON.stringify({
                    issues: [
                      {
                        issue: "Standing",
                        sourceDocumentId: "doc_issues",
                      },
                    ],
                  }),
              model: "test-model",
              provider: "test-provider",
            };
          },
        },
        readyDocuments: [
          {
            fileName: "Motion.pdf",
            id: "doc_issues",
            markdown: "The stop lacked reasonable suspicion.",
          },
        ],
      },
    );

    expect(callCount).toBe(2);
    expect(requests[1]).toContain("Return only valid JSON.");
    expect(requests[1]).toContain("Do not include Markdown.");
    expect(result).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
  });

  it("keeps invalid JSON failure at window/document scope when another document succeeds", async () => {
    let callCount = 0;

    const result = await runExtractionProfile(testIssuesProfile, {
      aiService: {
        generateText: async () => {
          callCount += 1;

          return {
            content: callCount === 1
              ? '{"issues":[{"issue":"Standing"}]'
              : JSON.stringify({
                  issues: [
                    {
                      issue: "Reasonable suspicion",
                      sourceDocumentId: "doc_good",
                    },
                  ],
                }),
            model: "test-model",
            provider: "test-provider",
          };
        },
      },
      readyDocuments: [
        {
          fileName: "Bad Motion.pdf",
          id: "doc_bad",
          markdown: "Bad output.",
        },
        {
          fileName: "Good Motion.pdf",
          id: "doc_good",
          markdown: "Good output.",
        },
      ],
    });

    expect(result).toMatchObject({
      errorCode: "EXTRACTION_JSON_PARSE_FAILED",
      failedWindowCount: 1,
      itemCount: 1,
      status: "PARTIAL_FAILED",
      windowCount: 2,
    });
  });

  it("runs a non-chronology profile without chronology fields", async () => {
    const result = await runExtractionProfile(testIssuesProfile, {
      aiService: {
        generateText: async (request) => {
          expect(request).toMatchObject({
            maxOutputTokens: 6000,
          });
          expect(request.messages[0]).toMatchObject({
            content: "Extract issues.",
            role: "system",
          });

          return {
            content: JSON.stringify({
              issues: [
                {
                  issue: "Whether the officer had reasonable suspicion.",
                  sourceDocumentId: "doc_issues",
                },
              ],
            }),
            model: "test-model",
            provider: "test-provider",
          };
        },
      },
      readyDocuments: [
        {
          fileName: "Motion.pdf",
          id: "doc_issues",
          markdown: "The stop lacked reasonable suspicion.",
        },
      ],
    });

    expect(result).toMatchObject({
      itemCount: 1,
      itemCountsByType: {
        issue: 1,
      },
      status: "COMPLETED",
      windowCount: 1,
    });
    expect(result.items).toEqual([
      {
        issue: "Whether the officer had reasonable suspicion.",
        sourceDocumentId: "doc_issues",
      },
    ]);
  });
});
