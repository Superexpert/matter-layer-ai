"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { WarningModal } from "@/components/warning-modal";
import { exportEditorContentToDocx } from "./docx-export";
import { editorHtmlToMarkdown } from "./conversion";
import type { DocumentEditorStepOutput } from "./schema";
import type { DocumentEditorStepState } from "./server";

type DocumentEditorStepComponentProps = {
  loadStepState: (input: {
    matterId: string;
    step: WorkflowStepDefinition;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<DocumentEditorStepState>;
  matterId: string;
  onComplete: (output: DocumentEditorStepOutput) => void;
  onExitReview?: () => void;
  onSavedToDocuments?: () => Promise<void>;
  saveArtifact: (input: {
    artifactId: string;
    contentMarkdown: string;
    editorJson?: unknown;
    matterId: string;
    stepId: string;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<DocumentEditorStepOutput>;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
};

type DocumentEditorSavePayload = {
  contentMarkdown: string;
  editorJson: unknown;
};

type DocumentEditorSurfaceProps = {
  contentHtml: string;
  description?: string;
  disabled?: boolean;
  errorFallback: string;
  exportButtonLabel?: string;
  initialSaveStatus?: "saved" | "unsaved";
  isLoading: boolean;
  onDone: () => void;
  onSave: (payload: DocumentEditorSavePayload) => Promise<void>;
  saveButtonLabel?: string;
  savedStatusLabel: string;
  title: string;
  unsavedStatusLabel: string;
};

function toolbarButtonClass(isActive = false) {
  return [
    "inline-flex h-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    isActive
      ? "border-[#5F4B76] bg-[#5F4B76] text-white"
      : "border-[#CFC5DA] bg-white text-[#4B3861] hover:bg-[#FBFAFC]",
  ].join(" ");
}

function documentActionButtonClass(variant: "primary" | "secondary" = "secondary") {
  const baseClass =
    "inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed";

  if (variant === "primary") {
    return `${baseClass} bg-[#5F4B76] text-white hover:bg-[#4B3861] disabled:bg-[#CFC5DA]`;
  }

  return `${baseClass} border border-[#CFC5DA] bg-white text-[#4B3861] hover:bg-[#FBFAFC] disabled:text-[#A79AB4]`;
}

function editorContentClass() {
  return "document-editor min-h-[28rem] rounded-b-xl border-x border-b border-[#E3DEEA] bg-white px-5 py-4 text-sm leading-7 text-[#211B27] outline-none prose prose-sm max-w-none";
}

const DocumentParagraph = Paragraph.extend({
  addAttributes() {
    return {
      nodeType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-node-type"),
        renderHTML: (attributes) => {
          if (attributes.nodeType !== "citation") {
            return {};
          }

          return {
            class: "document-citation",
            "data-node-type": "citation",
          };
        },
      },
    };
  },
});

export function DocumentEditorSurface({
  contentHtml,
  description,
  disabled = false,
  errorFallback,
  exportButtonLabel = "Export",
  initialSaveStatus = "saved",
  isLoading,
  onDone,
  onSave,
  saveButtonLabel = "Save",
  savedStatusLabel,
  title,
  unsavedStatusLabel,
}: DocumentEditorSurfaceProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("unsaved");
  const [errorMessage, setErrorMessage] = useState("");
  const [showUnsavedChangesWarning, setShowUnsavedChangesWarning] = useState(false);
  const initialSaveStatusRef = useRef(initialSaveStatus);
  const lastSavedContentMarkdownRef = useRef<string | null>(null);
  const editor = useEditor({
    content: contentHtml,
    editorProps: {
      attributes: {
        class: editorContentClass(),
      },
    },
    extensions: [
      StarterKit.configure({
        paragraph: false,
      }),
      DocumentParagraph,
      Link.configure({
        openOnClick: false,
      }),
    ],
    immediatelyRender: false,
    onUpdate: ({ editor: updatedEditor }) => {
      const lastSavedContentMarkdown = lastSavedContentMarkdownRef.current;
      const currentContentMarkdown = editorHtmlToMarkdown(updatedEditor.getHTML());

      setSaveStatus(
        lastSavedContentMarkdown !== null &&
          currentContentMarkdown === lastSavedContentMarkdown
          ? "saved"
          : "unsaved",
      );
    },
  });
  const toolbarState = useEditorState({
    editor,
    selector: (snapshot) => {
      const currentEditor = snapshot.editor;

      return {
        bold: Boolean(currentEditor?.isActive("bold")),
        bulletList: Boolean(currentEditor?.isActive("bulletList")),
        heading2: Boolean(currentEditor?.isActive("heading", { level: 2 })),
        heading3: Boolean(currentEditor?.isActive("heading", { level: 3 })),
        italic: Boolean(currentEditor?.isActive("italic")),
        orderedList: Boolean(currentEditor?.isActive("orderedList")),
      };
    },
  }) ?? {
    bold: false,
    bulletList: false,
    heading2: false,
    heading3: false,
    italic: false,
    orderedList: false,
  };

  useEffect(() => {
    initialSaveStatusRef.current = initialSaveStatus;
  }, [initialSaveStatus]);

  useEffect(() => {
    if (!editor || isLoading) {
      return;
    }

    editor.commands.setContent(contentHtml);
    let isCurrent = true;
    const loadedContentMarkdown = editorHtmlToMarkdown(contentHtml);
    queueMicrotask(() => {
      if (isCurrent) {
        const nextInitialSaveStatus = initialSaveStatusRef.current;
        lastSavedContentMarkdownRef.current =
          nextInitialSaveStatus === "saved" ? loadedContentMarkdown : null;
        setSaveStatus(nextInitialSaveStatus);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [contentHtml, editor, isLoading]);

  async function saveDocument() {
    if (!editor) {
      return;
    }

    setIsSaving(true);
    setSaveStatus("saving");
    setErrorMessage("");

    try {
      const contentMarkdown = editorHtmlToMarkdown(editor.getHTML());

      await onSave({
        contentMarkdown,
        editorJson: JSON.parse(JSON.stringify(editor.getJSON())),
      });
      lastSavedContentMarkdownRef.current = contentMarkdown;
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("unsaved");
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : errorFallback,
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function exportDocx() {
    if (!editor) {
      return;
    }

    setIsExporting(true);
    setErrorMessage("");

    try {
      await exportEditorContentToDocx({
        editorJson: JSON.parse(JSON.stringify(editor.getJSON())),
        title,
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Could not export this document to Word. Please try again.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  const hasUnsavedChanges = saveStatus !== "saved";

  function done() {
    if (hasUnsavedChanges) {
      setShowUnsavedChangesWarning(true);
      return;
    }

    onDone();
  }

  return (
    <section className="grid gap-5" data-testid="shared-document-editor">
      <div>
        <h2 className="text-lg font-semibold text-[#211B27]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-[#74677F]">
            {description}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border border-[#E3DEEA] bg-white px-3 py-2">
            <div className="flex flex-wrap gap-2">
              <button
                className={toolbarButtonClass(toolbarState.bold)}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleBold().run()}
                type="button"
              >
                B
              </button>
              <button
                className={toolbarButtonClass(toolbarState.italic)}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                type="button"
              >
                I
              </button>
              <button
                className={toolbarButtonClass(toolbarState.heading2)}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                type="button"
              >
                H2
              </button>
              <button
                className={toolbarButtonClass(toolbarState.heading3)}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
                type="button"
              >
                H3
              </button>
              <button
                className={toolbarButtonClass(toolbarState.bulletList)}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                type="button"
              >
                Bullets
              </button>
              <button
                className={toolbarButtonClass(toolbarState.orderedList)}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                type="button"
              >
                Numbered
              </button>
              <button
                className={toolbarButtonClass()}
                disabled={!editor || !editor.can().undo()}
                onClick={() => editor?.chain().focus().undo().run()}
                type="button"
              >
                Undo
              </button>
              <button
                className={toolbarButtonClass()}
                disabled={!editor || !editor.can().redo()}
                onClick={() => editor?.chain().focus().redo().run()}
                type="button"
              >
                Redo
              </button>
            </div>
            <span className="rounded-full border border-[#CFC5DA] bg-[#FBFAFC] px-3 py-1 text-xs font-semibold text-[#4B3861]">
              {isLoading
                ? "Loading"
                : isSaving
                ? "Saving"
                : saveStatus === "saved"
                  ? savedStatusLabel
                  : unsavedStatusLabel}
            </span>
          </div>
          {isLoading ? (
            <p className="rounded-b-xl border-x border-b border-[#E3DEEA] bg-white px-5 py-4 text-sm leading-6 text-[#74677F]">
              Loading document...
            </p>
          ) : (
            <EditorContent data-testid="document-editor-content" editor={editor} />
          )}
        </div>
      </div>

      {errorMessage ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
          data-testid="document-editor-error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <button
          className={documentActionButtonClass("primary")}
          data-testid="document-editor-save"
          disabled={isLoading || isSaving || disabled || !editor}
          onClick={() => {
            void saveDocument();
          }}
          type="button"
        >
          {isSaving ? "Saving..." : saveButtonLabel}
        </button>
        <button
          className={documentActionButtonClass()}
          data-testid="document-editor-export-docx"
          disabled={isLoading || isExporting || disabled || !editor}
          onClick={() => {
            void exportDocx();
          }}
          type="button"
        >
          {isExporting ? "Exporting..." : exportButtonLabel}
        </button>
        <button
          className={documentActionButtonClass()}
          data-testid="document-editor-continue"
          onClick={done}
          type="button"
        >
          Done
        </button>
      </div>
      <WarningModal
        cancelLabel="Cancel"
        cancelTestId="cancel-unsaved-document"
        confirmLabel="Leave without saving"
        confirmTestId="leave-unsaved-document"
        message="You have unsaved changes to this document. If you leave now, those changes may be lost."
        onCancel={() => setShowUnsavedChangesWarning(false)}
        onConfirm={onDone}
        open={showUnsavedChangesWarning}
        testId="unsaved-document-dialog"
        title="Unsaved document changes"
        variant="warning"
      />
    </section>
  );
}

export function DocumentEditorStepComponent({
  loadStepState,
  matterId,
  onComplete,
  onExitReview,
  onSavedToDocuments,
  saveArtifact,
  step,
  workflowDefinitionId,
  workflowRunId,
}: DocumentEditorStepComponentProps) {
  const [state, setState] = useState<DocumentEditorStepState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [latestOutput, setLatestOutput] = useState<DocumentEditorStepOutput | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadState() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const nextState = await loadStepState({
          matterId,
          step,
          workflowDefinitionId,
          workflowRunId,
        });

        if (!isCurrent) {
          return;
        }

        setState(nextState);
        setLatestOutput(nextState.latestOutput);
      } catch (error) {
        if (isCurrent) {
          setErrorMessage(
            error instanceof Error && error.message.trim()
              ? error.message
              : "Matter Layer could not load the document editor.",
          );
        }
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
  }, [loadStepState, matterId, step, workflowDefinitionId, workflowRunId]);

  async function saveDocument(payload: DocumentEditorSavePayload) {
    if (!state) {
      throw new Error("Document editor state has not loaded.");
    }

    const output = await saveArtifact({
      artifactId: state.artifactId,
      contentMarkdown: payload.contentMarkdown,
      editorJson: payload.editorJson,
      matterId,
      stepId: step.id,
      workflowDefinitionId,
      workflowRunId,
    });

    setLatestOutput(output);
    void onSavedToDocuments?.().catch((error) => {
      console.error("Matter Layer could not refresh matter documents after save.", error);
    });
  }

  function completeReviewStep() {
    if (latestOutput) {
      onComplete(latestOutput);
      return;
    }

    if (!onExitReview) {
      throw new Error("Leaving a document editor step without saved output requires an exit handler.");
    }

    onExitReview();
  }

  return (
    <section data-testid="document-editor-step">
      {errorMessage ? (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
          data-testid="document-editor-error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : (
        <DocumentEditorSurface
          contentHtml={state?.editorContentHtml ?? ""}
          description={step.description}
          disabled={!state}
          errorFallback="Matter Layer could not save the reviewed document."
          exportButtonLabel="Export"
          initialSaveStatus={latestOutput ? "saved" : "unsaved"}
          isLoading={isLoading}
          onDone={completeReviewStep}
          onSave={saveDocument}
          savedStatusLabel={latestOutput?.savedMatterDocumentId ? "Saved to Documents" : "Not saved to Documents"}
          title={step.name}
          unsavedStatusLabel={latestOutput?.savedMatterDocumentId ? "Unsaved changes" : "Not saved to Documents"}
        />
      )}
    </section>
  );
}
