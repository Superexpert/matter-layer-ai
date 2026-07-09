import { notFound } from "next/navigation";

import { requireConfiguredAISettings } from "@/services/ai/ai-settings-service";
import { isCurrentUserAdmin } from "@/services/auth";
import {
  listEnabledWorkflowCatalog,
  syncBuiltInWorkflows,
} from "@/services/workflows/catalog-service";
import { listMatterDocuments } from "@/services/matter-documents/matter-document-service";
import { listWorkflowRunSummaries } from "@/services/workflows/workflow-run-service";

import { MatterChat } from "./MatterChat";

type MatterPageProps = {
  params: Promise<{
    matterId: string;
  }>;
};

export default async function MatterPage({ params }: MatterPageProps) {
  const { matterId } = await params;
  await requireConfiguredAISettings();

  const [{ prisma }, isAdmin] = await Promise.all([
    import("@/lib/prisma"),
    isCurrentUserAdmin(),
  ]);

  const matter = await prisma.matter.findUnique({
    where: {
      id: matterId,
    },
    select: {
      name: true,
    },
  });

  if (!matter) {
    notFound();
  }

  await syncBuiltInWorkflows();
  const [workflowCatalog, documents, workflowRuns] = await Promise.all([
    listEnabledWorkflowCatalog(),
    listMatterDocuments({
      matterId,
    }),
    listWorkflowRunSummaries({
      matterId,
    }),
  ]);

  return (
    <MatterChat
      initialDocuments={documents}
      initialWorkflowRuns={workflowRuns}
      isAdmin={isAdmin}
      matterId={matterId}
      matterName={matter.name}
      workflowDefinitions={workflowCatalog}
    />
  );
}
