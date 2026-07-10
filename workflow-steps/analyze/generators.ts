import type { AnalyzeFactPacket } from "./compact-facts";
import type { AnalyzeGeneratorConfig } from "./schema";

export const ANALYZE_SYSTEM_INSTRUCTIONS = `You are generating a legal work product from a controlled matter-fact packet.
Use only the supplied facts and citations. Do not use outside factual knowledge.
Do not invent facts, dates, amounts, documents, legal conclusions, or procedural events.
Treat conflicting values as unresolved and do not choose a winner unless supplied facts resolve it.
Distinguish allegations, assumptions, anticipated impacts, and confirmed facts.
Do not expose extraction, identity-collapse, packet, AI, prompt, or workflow implementation details.
Return Markdown only. Cite material factual statements using the supplied Matter Layer citation syntax.`;

export function analyzeGeneratorMessages(input: {
  generator: AnalyzeGeneratorConfig;
  packet: AnalyzeFactPacket;
}) {
  return [
    { content: ANALYZE_SYSTEM_INSTRUCTIONS, role: "system" as const },
    {
      content: [
        `Work product: ${input.generator.outputName}`,
        "Generator instructions:",
        input.generator.instructions,
        "Citation instructions:",
        "Use inline citation chips in this exact form, filling values from packet citations:",
        '<span data-ml-citation="true" data-citation-label="Document p. 1" data-citation-printable-text="(Document, p. 1)" data-citation-source-document-id="..." data-citation-source-document-name="..." data-citation-page="1" data-citation-cited-text="supporting excerpt">Document p. 1</span>',
        "Compact fact packet:",
        JSON.stringify(input.packet),
      ].join("\n\n"),
      role: "user" as const,
    },
  ];
}
