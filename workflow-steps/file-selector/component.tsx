"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkflowStepDefinition } from "@/services/workflows/types";
import {
  normalizeFileSelectorConfig,
  validateFileSelectorOutput,
  type FileSelectorStepConfig,
  type FileSelectorStepOutput,
} from "./schema";
import type {
  FileSelectorMatterDocument,
  FileSelectorStepState,
} from "./server";

type FileSelectorStepComponentProps = {
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
  loadStepState: (input: {
    matterId: string;
    stepId: string;
    workflowRunId: string;
  }) => Promise<FileSelectorStepState>;
  uploadFiles: (input: {
    config: FileSelectorStepConfig;
    formData: FormData;
    matterId: string;
  }) => Promise<FileSelectorMatterDocument[]>;
  saveSelection: (input: {
    config: FileSelectorStepConfig;
    matterId: string;
    selectedMatterDocumentIds: string[];
    stepId: string;
    uploadedDuringStepMatterDocumentIds: string[];
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<FileSelectorStepOutput>;
  onComplete: (output: FileSelectorStepOutput) => void;
};

export function isFileSelectorDocumentSelectable(input: {
  allowExistingMatterFiles: boolean;
  documentId: string;
  uploadedDuringStepMatterDocumentIds: string[];
}) {
  return (
    input.allowExistingMatterFiles ||
    input.uploadedDuringStepMatterDocumentIds.includes(input.documentId)
  );
}

export function FileSelectorStepComponent({
  loadStepState,
  matterId,
  onComplete,
  saveSelection,
  step,
  uploadFiles,
  workflowDefinitionId,
  workflowRunId,
}: FileSelectorStepComponentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = useMemo(
    () => normalizeFileSelectorConfig(step.parameters),
    [step.parameters],
  );
  const [documents, setDocuments] = useState<FileSelectorMatterDocument[]>([]);
  const [selectedMatterDocumentIds, setSelectedMatterDocumentIds] = useState<string[]>([]);
  const [uploadedDuringStepMatterDocumentIds, setUploadedDuringStepMatterDocumentIds] =
    useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedDocumentIdSet = useMemo(
    () => new Set(selectedMatterDocumentIds),
    [selectedMatterDocumentIds],
  );
  const selectableDocuments = useMemo(
    () =>
      documents.filter((document) =>
        isFileSelectorDocumentSelectable({
          allowExistingMatterFiles: config.allowExistingMatterFiles,
          documentId: document.id,
          uploadedDuringStepMatterDocumentIds,
        }),
      ),
    [config.allowExistingMatterFiles, documents, uploadedDuringStepMatterDocumentIds],
  );
  const selectableDocumentIds = useMemo(
    () => selectableDocuments.map((document) => document.id),
    [selectableDocuments],
  );
  const allSelectableDocumentsSelected =
    selectableDocumentIds.length > 0 &&
    selectableDocumentIds.every((documentId) => selectedDocumentIdSet.has(documentId));
  const validationError = validateFileSelectorOutput(
    {
      selectedMatterDocumentIds,
    },
    config,
  );
  const acceptAttribute = config.acceptedMimeTypes?.join(",") ?? undefined;

  useEffect(() => {
    let isCurrent = true;

    async function loadState() {
      if (isCurrent) {
        setIsLoading(true);
        setErrorMessage("");
      }

      try {
        const state = await loadStepState({
          matterId,
          stepId: step.id,
          workflowRunId,
        });

        if (!isCurrent) {
          return;
        }

        setDocuments(state.documents);
        setSelectedMatterDocumentIds(state.selectedMatterDocumentIds);
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setErrorMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : "Matter Layer could not load matter documents.",
        );
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadState();

    return () => {
      isCurrent = false;
    };
  }, [loadStepState, matterId, step.id, workflowRunId]);

  function toggleDocument(documentId: string) {
    setErrorMessage("");
    setSelectedMatterDocumentIds((currentIds) => {
      if (currentIds.includes(documentId)) {
        return currentIds.filter((currentId) => currentId !== documentId);
      }

      if (config.maxFiles !== null && currentIds.length >= config.maxFiles) {
        setErrorMessage(`Select no more than ${config.maxFiles} file${config.maxFiles === 1 ? "" : "s"}.`);
        return currentIds;
      }

      return [...currentIds, documentId];
    });
  }

  function canSelectDocument(documentId: string) {
    return isFileSelectorDocumentSelectable({
      allowExistingMatterFiles: config.allowExistingMatterFiles,
      documentId,
      uploadedDuringStepMatterDocumentIds,
    });
  }

  function toggleAllSelectableDocuments() {
    setErrorMessage("");

    if (allSelectableDocumentsSelected) {
      setSelectedMatterDocumentIds((currentIds) =>
        currentIds.filter((documentId) => !selectableDocumentIds.includes(documentId)),
      );
      return;
    }

    setSelectedMatterDocumentIds((currentIds) => {
      const nextIds = [...currentIds];
      const selectedIds = new Set(nextIds);
      const remainingSlots = config.maxFiles === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, config.maxFiles - nextIds.length);
      let addedCount = 0;

      for (const documentId of selectableDocumentIds) {
        if (selectedIds.has(documentId)) {
          continue;
        }

        if (addedCount >= remainingSlots) {
          break;
        }

        selectedIds.add(documentId);
        nextIds.push(documentId);
        addedCount += 1;
      }

      if (
        config.maxFiles !== null &&
        selectableDocumentIds.some((documentId) => !selectedIds.has(documentId))
      ) {
        setErrorMessage(`Select no more than ${config.maxFiles} file${config.maxFiles === 1 ? "" : "s"}.`);
      }

      return nextIds;
    });
  }

  async function handleUpload(files: FileList | null) {
    const fileArray = Array.from(files ?? []);

    if (fileArray.length === 0) {
      return;
    }

    setErrorMessage("");

    const unsupportedFile = config.acceptedMimeTypes?.length
      ? fileArray.find((file) => !config.acceptedMimeTypes?.includes(file.type))
      : null;

    if (unsupportedFile) {
      setErrorMessage(`Unsupported file type: ${unsupportedFile.type || "unknown"}.`);
      return;
    }

    if (
      config.maxFiles !== null &&
      selectedMatterDocumentIds.length + fileArray.length > config.maxFiles
    ) {
      setErrorMessage(`Select no more than ${config.maxFiles} file${config.maxFiles === 1 ? "" : "s"}.`);
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();

      fileArray.forEach((file) => {
        formData.append("files", file);
      });

      const uploadedDocuments = await uploadFiles({
        config,
        formData,
        matterId,
      });
      const uploadedIds = uploadedDocuments.map((document) => document.id);

      setDocuments((currentDocuments) => [...uploadedDocuments, ...currentDocuments]);
      setSelectedMatterDocumentIds((currentIds) => [
        ...currentIds,
        ...uploadedIds.filter((documentId) => !currentIds.includes(documentId)),
      ]);
      setUploadedDuringStepMatterDocumentIds((currentIds) => [
        ...currentIds,
        ...uploadedIds.filter((documentId) => !currentIds.includes(documentId)),
      ]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not upload the selected files.",
      );
    } finally {
      setIsUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function continueWorkflow() {
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const output = await saveSelection({
        config,
        matterId,
        selectedMatterDocumentIds,
        stepId: step.id,
        uploadedDuringStepMatterDocumentIds,
        workflowDefinitionId,
        workflowRunId,
      });

      onComplete(output);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not save the selected documents.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="grid gap-5" data-testid="file-selector-step">
      <div>
        <h2 className="text-lg font-semibold text-[#211B27]">
          {step.name}
        </h2>
        {step.description ? (
          <p className="mt-1 text-sm leading-6 text-[#74677F]">
            {step.description}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-[#211B27]">
            Matter documents
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {selectableDocumentIds.length > 0 ? (
              <button
                className="inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-[#5F4B76] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:text-[#A79AB4]"
                data-testid="file-selector-select-all"
                disabled={isLoading || isUploading}
                onClick={toggleAllSelectableDocuments}
                type="button"
              >
                {allSelectableDocumentsSelected ? "Clear selection" : "Select all"}
              </button>
            ) : null}
            {config.allowUpload ? (
              <div>
                <input
                  accept={acceptAttribute}
                  className="sr-only"
                  data-testid="file-selector-upload-input"
                  multiple
                  onChange={(event) => {
                    void handleUpload(event.target.files);
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <button
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC] disabled:cursor-not-allowed disabled:text-[#A79AB4]"
                  data-testid="file-selector-upload-button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  {isUploading ? "Uploading..." : "Upload Files"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {isLoading ? (
          <p className="mt-4 rounded-lg border border-[#E3DEEA] bg-white p-3 text-sm leading-6 text-[#74677F]">
            Loading matter documents...
          </p>
        ) : documents.length ? (
          <div className="mt-4 grid gap-2" data-testid="file-selector-document-list">
            {documents.map((document) => (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#E3DEEA] bg-white p-3 transition-colors hover:border-[#CFC5DA]"
                data-testid={`file-selector-document-${document.id}`}
                key={document.id}
              >
                <input
                  checked={selectedDocumentIdSet.has(document.id)}
                  className="mt-1 h-4 w-4 accent-[#5F4B76]"
                  data-testid={`file-selector-checkbox-${document.id}`}
                  disabled={!canSelectDocument(document.id)}
                  onChange={() => toggleDocument(document.id)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#211B27]">
                    {document.fileName}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p
            className="mt-4 rounded-lg border border-dashed border-[#CFC5DA] bg-white p-4 text-sm leading-6 text-[#74677F]"
            data-testid="file-selector-empty-state"
          >
            No matter documents have been added yet.
          </p>
        )}
      </div>

      {errorMessage ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
          data-testid="file-selector-validation"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      <button
        className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]"
        data-testid="file-selector-continue"
        disabled={Boolean(validationError) || isLoading || isSaving}
        onClick={() => {
          void continueWorkflow();
        }}
        type="button"
      >
        {isSaving ? "Saving..." : "Continue"}
      </button>
    </section>
  );
}
