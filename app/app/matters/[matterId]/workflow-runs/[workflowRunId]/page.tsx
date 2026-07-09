import Link from "next/link";
import { notFound } from "next/navigation";

import { AppContainer } from "@/components/app-container";
import { getWorkflowCatalogItem } from "@/services/workflows/catalog-service";
import {
  getEditableWorkflowArtifact,
  getWorkflowRunDetails,
} from "@/services/workflows/workflow-run-service";

import { WorkflowRunDetailsClient } from "./WorkflowRunDetailsClient";

type WorkflowRunPageProps = {
  params: Promise<{
    matterId: string;
    workflowRunId: string;
  }>;
};

function formatRunDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status: "running" | "completed" | "failed") {
  if (status === "completed") {
    return "Complete";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "In progress";
}

export default async function WorkflowRunPage({ params }: WorkflowRunPageProps) {
  const { matterId, workflowRunId } = await params;
  let workflowRun;

  try {
    workflowRun = await getWorkflowRunDetails({
      matterId,
      workflowRunId,
    });
  } catch {
    notFound();
  }

  let workflowDefinition;

  try {
    workflowDefinition = await getWorkflowCatalogItem(workflowRun.workflowDefinitionId);
  } catch {
    notFound();
  }

  const generatedAt = workflowRun.completedAt ?? workflowRun.updatedAt;
  const editableWorkProducts = await Promise.all(
    workflowRun.workProducts.map((workProduct) =>
      getEditableWorkflowArtifact({
        artifactId: workProduct.id,
        matterId,
        workflowRunId,
      }),
    ),
  );
  const workProductCount = workflowRun.workProducts.length;
  const caseFileCount = workflowRun.inputCaseFileCount;

  return (
    <main className="min-h-screen bg-[#F7F6FA] text-[#211B27]">
      <div className="border-b border-[#312342] bg-[#42305B]">
        <AppContainer className="flex h-14 items-center justify-between gap-4">
          <Link
            className="shrink-0 text-sm font-semibold tracking-[0.01em] text-white"
            href="/app/matters"
          >
            Matter Layer
          </Link>
          <Link
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] hover:bg-white/10 hover:text-white"
            href={`/app/matters/${matterId}`}
          >
            Back to matter
          </Link>
        </AppContainer>
      </div>

      <AppContainer className="grid gap-4 py-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="rounded-[14px] border border-[#E3DEEA] bg-white p-5 shadow-[0_1px_2px_rgba(40,29,52,0.05)]">
          <div className="border-b border-[#E3DEEA] pb-5">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
              Review Work Products
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[#211B27]">
              {workflowRun.status === "completed"
                ? `${workflowRun.workflowName} Complete`
                : workflowRun.workflowName}
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#74677F]">
              Matter Layer created {workProductCount} work product{workProductCount === 1 ? "" : "s"} from {caseFileCount} case file{caseFileCount === 1 ? "" : "s"}.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm leading-6 text-[#74677F]">
              <span>Generated {formatRunDate(generatedAt)}</span>
              <span>Status: {statusLabel(workflowRun.status)}</span>
            </div>
          </div>

          <WorkflowRunDetailsClient
            initialEditableWorkProducts={editableWorkProducts}
            matterId={matterId}
            workflowRun={workflowRun}
            workflowRunId={workflowRunId}
          />
        </section>

        <aside
          className="h-fit rounded-[14px] border border-[#E3DEEA] bg-white p-4 shadow-[0_1px_2px_rgba(40,29,52,0.05)]"
          data-testid="workflow-run-review-canvas"
        >
          <h2 className="text-base font-semibold text-[#211B27]">
            {workflowDefinition.name}
          </h2>
          <ol className="mt-4 grid gap-3" data-testid="workflow-run-canvas">
            {workflowDefinition.steps.map((step, index) => (
              <li
                aria-current={
                  step.type === "reviewWorkProducts" ? "step" : undefined
                }
                className={
                  step.type === "reviewWorkProducts"
                    ? "rounded-lg border border-[#5F4B76] bg-[#FBFAFC] p-3"
                    : "rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] p-3"
                }
                key={step.id}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5F4B76] text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#211B27]">
                      {step.name}
                    </p>
                    {step.description ? (
                      <p className="mt-1 text-sm leading-5 text-[#74677F]">
                        {step.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </AppContainer>
    </main>
  );
}
