"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { CitationNode, type CitationNodeAttributes } from "./citation-extension";
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
  loadCitationSource?: (input: {
    matterId: string;
    sourceDocumentId: string;
  }) => Promise<CitationSourcePreview>;
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

export type CitationSourcePreview = {
  originalUrl: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceSize: number;
  title: string;
};

type DocumentEditorSurfaceProps = {
  completionButtonLabel?: string;
  contentHtml: string;
  description?: string;
  disabled?: boolean;
  errorFallback: string;
  exportButtonLabel?: string;
  hideCompletionButton?: boolean;
  initialSaveStatus?: "saved" | "unsaved";
  isLoading: boolean;
  loadCitationSource?: (input: {
    matterId: string;
    sourceDocumentId: string;
  }) => Promise<CitationSourcePreview>;
  matterId?: string;
  onDone: (saveResult?: unknown) => void;
  onSave: (payload: DocumentEditorSavePayload) => Promise<unknown>;
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

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size < 0) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const kib = size / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`;
  }

  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`;
}

function formatMimeType(mimeType: string) {
  if (mimeType === "application/pdf") {
    return "PDF";
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "DOCX";
  }

  if (mimeType === "text/plain") {
    return "Text";
  }

  if (mimeType === "text/markdown") {
    return "Markdown";
  }

  return mimeType || "Unknown";
}

function locationParts(citation: CitationNodeAttributes) {
  const parts: string[] = [];

  const pageStart = citation.pageStart ?? citation.page;
  const pageEnd = citation.pageEnd ?? pageStart;
  if (pageStart) {
    parts.push(pageEnd && pageEnd !== pageStart ? `Pages ${pageStart}-${pageEnd}` : `Page ${pageStart}`);
  }

  if (citation.paragraphNumber) {
    parts.push(`paragraph ${citation.paragraphNumber}`);
  }

  if (citation.locationLabel) {
    parts.push(citation.locationLabel);
  }

  if (citation.locationText && !parts.includes(citation.locationText)) {
    parts.push(citation.locationText);
  }

  return parts;
}

function citationExcerpt(citation: CitationNodeAttributes) {
  return citation.citedText?.trim()
    || citation.surroundingText?.trim()
    || null;
}

function editorContentClass() {
  return "document-editor document-editor-content min-h-[28rem] rounded-b-xl border-x border-b border-[#E3DEEA] bg-white px-5 py-4 text-sm leading-7 text-[#211B27] outline-none prose prose-sm max-w-none";
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

function isCitationNodeAttributes(value: Record<string, unknown>): value is CitationNodeAttributes {
  return (
    typeof value.label === "string" &&
    typeof value.printableText === "string" &&
    typeof value.sourceDocumentName === "string"
  );
}

function citationAttributesFromUnknown(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const attributes = value as Record<string, unknown>;

  return isCitationNodeAttributes(attributes) ? attributes : null;
}

function CitationSourceModal({
  citation,
  errorMessage,
  isLoading,
  onClose,
  preview,
}: {
  citation: CitationNodeAttributes;
  errorMessage: string;
  isLoading: boolean;
  onClose: () => void;
  preview: CitationSourcePreview | null;
}) {
  const excerpt = citationExcerpt(citation);
  const noExcerptMessage = "No source excerpt was captured for this citation.";
  const locations = locationParts(citation);
  const fileDescription = preview
    ? [formatMimeType(preview.sourceMimeType), formatFileSize(preview.sourceSize)]
      .filter(Boolean)
      .join(" · ")
    : "";

  return (
    <div
      aria-labelledby="citation-source-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#211B27]/35 px-4 py-6"
      data-testid="citation-source-modal"
      role="dialog"
    >
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-xl border border-[#E3DEEA] bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E3DEEA] px-5 py-4">
          <div>
            <h2
              className="text-base font-semibold text-[#211B27]"
              id="citation-source-title"
            >
              Citation Source
            </h2>
            <p className="mt-1 text-xs font-semibold text-[#74677F]">
              {preview?.sourceFileName ?? citation.sourceDocumentName}
            </p>
          </div>
          <button
            aria-label="Close source preview"
            className="inline-flex h-8 items-center justify-center rounded-md border border-[#CFC5DA] bg-white px-3 text-sm font-semibold text-[#4B3861] hover:bg-[#FBFAFC]"
            data-testid="citation-source-modal-close"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="min-h-48 overflow-auto px-5 py-4">
          {isLoading ? (
            <p className="text-sm leading-6 text-[#74677F]">Loading source...</p>
          ) : errorMessage ? (
            <p
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
              data-testid="citation-source-modal-error"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : preview ? (
            <div
              className="grid gap-5 text-sm text-[#211B27]"
              data-testid="citation-source-modal-content"
            >
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#74677F]">
                  Document
                </h3>
                <p className="mt-2 font-semibold text-[#211B27]">
                  {preview.sourceFileName}
                </p>
                {fileDescription ? (
                  <p className="mt-1 text-xs font-medium text-[#74677F]">
                    {fileDescription}
                  </p>
                ) : null}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#74677F]">
                  Cited Text
                </h3>
                <blockquote
                  className="mt-2 rounded-lg border-l-4 border-[#CFC5DA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#211B27]"
                  data-testid="citation-source-modal-cited-text"
                >
                  {excerpt ?? noExcerptMessage}
                </blockquote>
              </section>

              {citation.surroundingText && citation.surroundingText !== excerpt ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#74677F]">
                    Context
                  </h3>
                  <p className="mt-2 rounded-lg border border-[#E3DEEA] bg-white px-4 py-3 leading-6 text-[#4F4658]">
                    {citation.surroundingText}
                  </p>
                </section>
              ) : null}

              {locations.length ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#74677F]">
                    Location
                  </h3>
                  <p className="mt-2 leading-6 text-[#4F4658]">
                    {locations.join(" / ")}
                  </p>
                </section>
              ) : null}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#74677F]">
                  Actions
                </h3>
                <a
                  className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-3 text-sm font-semibold text-[#4B3861] hover:bg-[#FBFAFC]"
                  data-testid="citation-source-open-original"
                  href={preview.originalUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open Original
                </a>
              </section>
            </div>
          ) : (
            <p className="text-sm leading-6 text-[#74677F]">
              This citation does not include a linked source document.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function DocumentEditorSurface({
  completionButtonLabel = "Done",
  contentHtml,
  description,
  disabled = false,
  errorFallback,
  exportButtonLabel = "Export",
  hideCompletionButton = false,
  initialSaveStatus = "saved",
  isLoading,
  loadCitationSource,
  matterId,
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
  const [selectedCitation, setSelectedCitation] = useState<CitationNodeAttributes | null>(null);
  const [citationPreview, setCitationPreview] = useState<CitationSourcePreview | null>(null);
  const [isCitationPreviewLoading, setIsCitationPreviewLoading] = useState(false);
  const [citationPreviewError, setCitationPreviewError] = useState("");
  const initialSaveStatusRef = useRef(initialSaveStatus);
  const lastSavedContentMarkdownRef = useRef<string | null>(null);

  function openCitationPreview(citation: CitationNodeAttributes) {
    setSelectedCitation(citation);
    setCitationPreview(null);
    setCitationPreviewError("");
  }

  const editor = useEditor({
    content: contentHtml,
    editorProps: {
      attributes: {
        class: editorContentClass(),
      },
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== "citation") {
          return false;
        }

        const citation = citationAttributesFromUnknown(node.attrs);
        if (citation) {
          openCitationPreview(citation);
        }

        return true;
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return false;
        }

        const selection = view.state.selection as unknown as {
          node?: {
            attrs?: unknown;
            type?: {
              name?: string;
            };
          };
        };

        if (selection.node?.type?.name !== "citation") {
          return false;
        }

        const citation = citationAttributesFromUnknown(selection.node.attrs);
        if (!citation) {
          return false;
        }

        event.preventDefault();
        openCitationPreview(citation);

        return true;
      },
    },
    extensions: [
      StarterKit.configure({
        paragraph: false,
      }),
      DocumentParagraph,
      CitationNode,
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
        heading1: Boolean(currentEditor?.isActive("heading", { level: 1 })),
        heading2: Boolean(currentEditor?.isActive("heading", { level: 2 })),
        heading3: Boolean(currentEditor?.isActive("heading", { level: 3 })),
        italic: Boolean(currentEditor?.isActive("italic")),
        orderedList: Boolean(currentEditor?.isActive("orderedList")),
      };
    },
  }) ?? {
    bold: false,
    bulletList: false,
    heading1: false,
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

  useEffect(() => {
    let isCurrent = true;

    async function loadPreview(citation: CitationNodeAttributes) {
      if (!citation.sourceDocumentId) {
        setCitationPreview(null);
        setCitationPreviewError("This citation does not include a linked source document.");
        return;
      }

      if (!matterId || !loadCitationSource) {
        setCitationPreview(null);
        setCitationPreviewError("Source preview is not available here.");
        return;
      }

      setIsCitationPreviewLoading(true);
      setCitationPreviewError("");

      try {
        const preview = await loadCitationSource({
          matterId,
          sourceDocumentId: citation.sourceDocumentId,
        });

        if (isCurrent) {
          setCitationPreview(preview);
        }
      } catch (error) {
        if (isCurrent) {
          setCitationPreview(null);
          setCitationPreviewError(
            error instanceof Error && error.message.trim()
              ? error.message
              : "Matter Layer could not load this source document.",
          );
        }
      } finally {
        if (isCurrent) {
          setIsCitationPreviewLoading(false);
        }
      }
    }

    if (selectedCitation) {
      void loadPreview(selectedCitation);
    }

    return () => {
      isCurrent = false;
    };
  }, [loadCitationSource, matterId, selectedCitation]);

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

  async function saveAndDone() {
    if (!editor) {
      return;
    }

    setIsSaving(true);
    setSaveStatus("saving");
    setErrorMessage("");

    try {
      const contentMarkdown = editorHtmlToMarkdown(editor.getHTML());

      const saveResult = await onSave({
        contentMarkdown,
        editorJson: JSON.parse(JSON.stringify(editor.getJSON())),
      });
      lastSavedContentMarkdownRef.current = contentMarkdown;
      setSaveStatus("saved");
      onDone(saveResult);
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

  return (
    <section className="grid gap-5" data-testid="shared-document-editor">
      {selectedCitation ? (
        <CitationSourceModal
          citation={selectedCitation}
          errorMessage={citationPreviewError}
          isLoading={isCitationPreviewLoading}
          onClose={() => {
            setSelectedCitation(null);
            setCitationPreview(null);
            setCitationPreviewError("");
          }}
          preview={citationPreview}
        />
      ) : null}

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
                className={toolbarButtonClass(toolbarState.heading1)}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
                type="button"
              >
                H1
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

      <div className={hideCompletionButton ? "grid gap-2 sm:grid-cols-2" : "grid gap-2 sm:grid-cols-3"}>
        <button
          className={documentActionButtonClass()}
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
        {hideCompletionButton ? null : (
          <button
            className={documentActionButtonClass("primary")}
            data-testid="document-editor-continue"
            disabled={isLoading || isSaving || disabled || !editor}
            onClick={() => {
              void saveAndDone();
            }}
            type="button"
          >
            {isSaving ? "Saving..." : completionButtonLabel}
          </button>
        )}
      </div>
    </section>
  );
}

export function DocumentEditorStepComponent({
  loadCitationSource,
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

    return output;
  }

  function completeReviewStep(saveResult?: unknown) {
    if (saveResult) {
      onComplete(saveResult as DocumentEditorStepOutput);
      return;
    }

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
          completionButtonLabel={state?.completionButtonLabel}
          contentHtml={state?.editorContentHtml ?? ""}
          description={step.description}
          disabled={!state}
          errorFallback="Matter Layer could not save the reviewed document."
          exportButtonLabel="Export"
          initialSaveStatus={latestOutput ? "saved" : "unsaved"}
          isLoading={isLoading}
          loadCitationSource={loadCitationSource}
          matterId={matterId}
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
