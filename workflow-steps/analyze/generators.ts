import type { AnalyzeFactPacket } from "./compact-facts";
import type { AnalyzeGeneratorConfig } from "./schema";

export const ANALYZE_SYSTEM_INSTRUCTIONS = `You are generating a legal work product from a controlled matter-fact packet.
Use only the supplied facts and citations. Do not use outside factual knowledge.
Do not invent facts, dates, amounts, documents, legal conclusions, or procedural events.
Treat conflicting values as unresolved and do not choose a winner unless supplied facts resolve it.
Distinguish allegations, assumptions, anticipated impacts, and confirmed facts.
Do not expose extraction, identity-collapse, packet, AI, prompt, or workflow implementation details.
Return the required structured response. Put the work product in the Markdown field. Cite material factual statements only with supplied Matter Layer citation IDs.`;

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
        "Insert {{ml-citation:CITATION_ID}} immediately after the supported sentence. Use only citationId values supplied in the compact fact packet.",
        "For multiple sources, insert multiple adjacent citation tokens. Never type a source filename as citation text and never create HTML citation spans.",
        "Compact fact packet:",
        JSON.stringify(input.packet),
      ].join("\n\n"),
      role: "user" as const,
    },
  ];
}
