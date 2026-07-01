import { describe, expect, it } from "vitest";

import { extractModelOutputItems } from "../../workflow-steps/extraction/json-output";
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
