"use client";

import { useState } from "react";

import type {
  EditableWorkflowArtifact,
  WorkflowRunDetails,
} from "@/services/workflows/workflow-run-service";
import { DocumentEditorSurface } from "@/workflow-steps/document-editor/component";

import {
  getCitationSourceDocumentPreviewAction,
  saveWorkflowArtifactEditsAction,
} from "../../workflow-actions";

type WorkflowRunDetailsClientProps = {
  initialEditableWorkProducts: EditableWorkflowArtifact[];
  matterId: string;
  workflowRun: WorkflowRunDetails;
  workflowRunId: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status: WorkflowRunDetails["status"]) {
  if (status === "completed") {
    return "Complete";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "In progress";
}

function workProductAnchorId(artifactId: string) {
  return `work-product-${artifactId}`;
}

export function WorkflowRunDetailsClient({
  initialEditableWorkProducts,
  matterId,
  workflowRun,
  workflowRunId,
}: WorkflowRunDetailsClientProps) {
  const [editableArtifacts, setEditableArtifacts] =
    useState<EditableWorkflowArtifact[]>(initialEditableWorkProducts);

  async function saveArtifact(artifactId: string, input: {
    contentMarkdown: string;
    editorJson: unknown;
  }) {
    const savedArtifact = await saveWorkflowArtifactEditsAction({
      artifactId,
      contentMarkdown: input.contentMarkdown,
      editorJson: input.editorJson,
      matterId,
      workflowRunId,
    });

    setEditableArtifacts((currentArtifacts) =>
      currentArtifacts.map((artifact) =>
        artifact.artifactId === savedArtifact.artifactId ? savedArtifact : artifact,
      ),
    );
    return savedArtifact;
  }

  return (
    <div className="mt-6 grid gap-6">
      <section data-testid="workflow-run-work-products">
        <div className="grid gap-8">
          {editableArtifacts.length ? (
            <>
              {editableArtifacts.length > 1 ? (
                <nav
                  aria-label="Generated work products"
                  className="rounded-lg border border-[#E3DEEA] bg-[#FBFAFC] px-4 py-3"
                  data-testid="workflow-run-work-product-navigation"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-sm font-semibold text-[#211B27]">
                      Work products:
                    </span>
                    {editableArtifacts.map((artifact) => (
                      <a
                        className="inline-flex h-8 items-center rounded-full border border-[#CFC5DA] bg-white px-3 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#F7F6FA]"
                        href={`#${workProductAnchorId(artifact.artifactId)}`}
                        key={artifact.artifactId}
                      >
                        {artifact.title}
                      </a>
                    ))}
                  </div>
                </nav>
              ) : null}

              {editableArtifacts.map((artifact) => (
                <div
                  className="scroll-mt-6"
                  data-testid={`workflow-run-work-product-${artifact.artifactId}`}
                  id={workProductAnchorId(artifact.artifactId)}
                  key={artifact.artifactId}
                >
                  <DocumentEditorSurface
                    contentHtml={artifact.editorContentHtml}
                    errorFallback="Matter Layer could not save this work product."
                    exportButtonLabel="Export DOCX"
                    hideCompletionButton
                    isLoading={false}
                    loadCitationSource={getCitationSourceDocumentPreviewAction}
                    matterId={matterId}
                    onDone={() => undefined}
                    onSave={(input) => saveArtifact(artifact.artifactId, input)}
                    savedStatusLabel="Saved"
                    saveButtonLabel="Save"
                    title={artifact.title}
                    unsavedStatusLabel="Unsaved changes"
                  />
                </div>
              ))}
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-[#CFC5DA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#74677F]">
              No generated work products yet.
            </p>
          )}
        </div>
      </section>

      <section data-testid="workflow-run-source-case-files">
        <h2 className="text-lg font-semibold text-[#211B27]">Source Case Files</h2>
        <div className="mt-3 grid gap-2">
          {workflowRun.inputCaseFiles.length ? (
            workflowRun.inputCaseFiles.map((caseFile) => (
              <div
                className="rounded-lg border border-[#E3DEEA] bg-white px-4 py-3 text-sm font-medium text-[#211B27]"
                key={caseFile.id}
              >
                {caseFile.fileName}
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-[#CFC5DA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#74677F]">
              No input case files were recorded for this workflow run.
            </p>
          )}
        </div>
      </section>

      <details
        className="rounded-lg border border-[#E3DEEA] bg-white p-4"
        data-testid="workflow-run-metadata"
      >
        <summary className="cursor-pointer text-sm font-semibold text-[#211B27]">
          Run Details
        </summary>
        <dl className="mt-4 grid gap-2 text-sm leading-6 text-[#74677F]">
          <div>
            <dt className="inline font-semibold text-[#4B3861]">Started at: </dt>
            <dd className="inline">{formatDate(workflowRun.createdAt)}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-[#4B3861]">Completed at: </dt>
            <dd className="inline">
              {workflowRun.completedAt ? formatDate(workflowRun.completedAt) : "Not complete"}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-[#4B3861]">AI provider: </dt>
            <dd className="inline">{workflowRun.aiProvider ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-[#4B3861]">Status: </dt>
            <dd className="inline">{statusLabel(workflowRun.status)}</dd>
          </div>
        </dl>
        {workflowRun.activities.length ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-[#211B27]">Step statuses</h3>
            <ul className="mt-2 grid gap-2 text-sm leading-6 text-[#74677F]">
              {workflowRun.activities.map((activity) => (
                <li key={activity.id}>
                  {activity.stepId}: {activity.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {workflowRun.errors.length ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">
            {workflowRun.errors.join("\n")}
          </div>
        ) : null}
      </details>
    </div>
  );
}
