import {
  Prisma,
  type PrismaClient,
  WorkflowArtifactType,
} from "@prisma/client";

import { generateChronologyMarkdown } from "./chronology-artifact";
import { collapseChronologyFacts } from "./collapse";
import { validateChronologyFact } from "./schema";

export type ChronologyPostprocessResult = {
  chronologyArtifactId: string | null;
  collapsedEventCount: number;
  datedCollapsedEventCount: number;
  undatedCollapsedEventCount: number;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function deletePriorArtifacts(input: {
  extractionRunId: string;
  matterId: string;
  prisma: PrismaClient;
  stepId: string;
  workflowRunId: string;
}) {
  const priorArtifacts = await input.prisma.workflowArtifact.findMany({
    select: {
      id: true,
      metadataJson: true,
    },
    where: {
      matterId: input.matterId,
      stepId: input.stepId,
      type: WorkflowArtifactType.MARKDOWN,
      workflowRunId: input.workflowRunId,
    },
  });
  const priorArtifactIds = priorArtifacts
    .filter((artifact) => {
      const metadata = artifact.metadataJson;
      return (
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        "extractionRunId" in metadata &&
        metadata.extractionRunId === input.extractionRunId
      );
    })
    .map((artifact) => artifact.id);

  if (priorArtifactIds.length === 0) {
    return;
  }

  await input.prisma.workflowArtifact.deleteMany({
    where: {
      id: {
        in: priorArtifactIds,
      },
    },
  });
}

export async function generateChronologyArtifactForRun(input: {
  extractionRunId: string;
  matterId: string;
  prisma: PrismaClient;
  selectedDocumentCount: number;
  stepId: string;
  workflowRunId: string;
}): Promise<ChronologyPostprocessResult> {
  const facts = await input.prisma.extractedFact.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      dataJson: true,
      id: true,
    },
    where: {
      extractionRunId: input.extractionRunId,
      matterId: input.matterId,
      stepId: input.stepId,
      workflowRunId: input.workflowRunId,
    },
  });
  const collapsedEvents = collapseChronologyFacts(
    facts.map((fact) => ({
      fact: validateChronologyFact(fact.dataJson),
      id: fact.id,
    })),
  );

  await input.prisma.collapsedChronologyEvent.deleteMany({
    where: {
      extractionRunId: input.extractionRunId,
    },
  });
  await deletePriorArtifacts(input);

  if (collapsedEvents.length === 0) {
    return {
      chronologyArtifactId: null,
      collapsedEventCount: 0,
      datedCollapsedEventCount: 0,
      undatedCollapsedEventCount: 0,
    };
  }

  await input.prisma.collapsedChronologyEvent.createMany({
    data: collapsedEvents.map((event) => ({
      actorsJson: jsonValue(event.actors),
      confidence: event.confidence,
      date: event.date,
      dateText: event.dateText,
      extractionRunId: input.extractionRunId,
      isApproximateDate: event.isApproximateDate,
      matterId: input.matterId,
      sortKey: event.sortKey,
      sourceFactsJson: jsonValue(event.sourceFactIds),
      sourcesJson: jsonValue(event.sources),
      stepId: input.stepId,
      summary: event.summary,
      title: event.title,
      workflowRunId: input.workflowRunId,
    })),
  });

  const markdown = generateChronologyMarkdown(collapsedEvents);
  const datedCollapsedEventCount = collapsedEvents.filter((event) => event.date).length;
  const undatedCollapsedEventCount = collapsedEvents.length - datedCollapsedEventCount;
  const artifact = await input.prisma.workflowArtifact.create({
    data: {
      content: markdown,
      matterId: input.matterId,
      metadataJson: jsonValue({
        collapsedEventCount: collapsedEvents.length,
        datedEventCount: datedCollapsedEventCount,
        extractionRunId: input.extractionRunId,
        generatedFromFactCount: facts.length,
        profile: "chronology",
        sourceDocumentCount: input.selectedDocumentCount,
        undatedEventCount: undatedCollapsedEventCount,
      }),
      stepId: input.stepId,
      title: "Chronology Draft",
      type: WorkflowArtifactType.MARKDOWN,
      workflowRunId: input.workflowRunId,
    },
  });

  return {
    chronologyArtifactId: artifact.id,
    collapsedEventCount: collapsedEvents.length,
    datedCollapsedEventCount,
    undatedCollapsedEventCount,
  };
}
