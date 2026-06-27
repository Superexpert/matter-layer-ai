"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { editorHtmlToMarkdown } from "./conversion";
import {
  normalizeDocumentEditorStepConfig,
  type DocumentEditorStepOutput,
} from "./schema";
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
  saveArtifact: (input: {
    artifactId: string;
    contentMarkdown: string;
    editorJson?: unknown;
    matterId: string;
    step: WorkflowStepDefinition;
    workflowDefinitionId: string;
    workflowRunId: string;
  }) => Promise<DocumentEditorStepOutput>;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
};

function toolbarButtonClass(isActive = false) {
  return [
    "inline-flex h-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    isActive
      ? "border-[#5F4B76] bg-[#5F4B76] text-white"
      : "border-[#CFC5DA] bg-white text-[#4B3861] hover:bg-[#FBFAFC]",
  ].join(" ");
}

export function DocumentEditorStepComponent({
  loadStepState,
  matterId,
  onComplete,
  saveArtifact,
  step,
  workflowDefinitionId,
  workflowRunId,
}: DocumentEditorStepComponentProps) {
  const config = useMemo(
    () => normalizeDocumentEditorStepConfig(step.parameters),
    [step.parameters],
  );
  const [state, setState] = useState<DocumentEditorStepState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [errorMessage, setErrorMessage] = useState("");
  const [latestOutput, setLatestOutput] = useState<DocumentEditorStepOutput | null>(null);
  const editor = useEditor({
    content: state?.editorContentHtml ?? "",
    editorProps: {
      attributes: {
        class:
          "min-h-[28rem] rounded-b-xl border-x border-b border-[#E3DEEA] bg-white px-5 py-4 text-sm leading-7 text-[#211B27] outline-none prose prose-sm max-w-none",
      },
    },
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
      }),
    ],
    immediatelyRender: false,
    onUpdate: () => {
      setSaveStatus("unsaved");
    },
  });

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
        setSaveStatus(nextState.latestOutput ? "saved" : "unsaved");
        editor?.commands.setContent(nextState.editorContentHtml);
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
  }, [editor, loadStepState, matterId, step, workflowDefinitionId, workflowRunId]);

  async function saveDocument() {
    if (!state || !editor) {
      return;
    }

    setIsSaving(true);
    setSaveStatus("saving");
    setErrorMessage("");

    try {
      const output = await saveArtifact({
        artifactId: state.artifactId,
        contentMarkdown: editorHtmlToMarkdown(editor.getHTML()),
        editorJson: editor.getJSON(),
        matterId,
        step,
        workflowDefinitionId,
        workflowRunId,
      });

      setLatestOutput(output);
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("unsaved");
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Matter Layer could not save the reviewed document.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const canContinue = latestOutput?.status === "completed";

  return (
    <section className="grid gap-5" data-testid="document-editor-step">
      <div>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
          Active Workflow
        </p>
        <h2 className="mt-2 text-lg font-semibold text-[#211B27]">
          {step.name}
        </h2>
        {step.description ? (
          <p className="mt-1 text-sm leading-6 text-[#74677F]">
            {step.description}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#211B27]">
              {state?.title ?? "Document"}
            </h3>
            <p className="mt-1 text-xs leading-5 text-[#74677F]">
              Editor: {config.editor} · Save mode: {config.saveMode}
            </p>
          </div>
          <span className="rounded-full border border-[#CFC5DA] bg-white px-3 py-1 text-xs font-semibold text-[#4B3861]">
            {isSaving ? "Saving" : saveStatus === "saved" ? "Saved" : "Unsaved changes"}
          </span>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-2 rounded-t-xl border border-[#E3DEEA] bg-white px-3 py-2">
            <button
              className={toolbarButtonClass(editor?.isActive("bold"))}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleBold().run()}
              type="button"
            >
              B
            </button>
            <button
              className={toolbarButtonClass(editor?.isActive("italic"))}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              type="button"
            >
              I
            </button>
            <button
              className={toolbarButtonClass(editor?.isActive("heading", { level: 2 }))}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              type="button"
            >
              H2
            </button>
            <button
              className={toolbarButtonClass(editor?.isActive("heading", { level: 3 }))}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
              type="button"
            >
              H3
            </button>
            <button
              className={toolbarButtonClass(editor?.isActive("bulletList"))}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              type="button"
            >
              Bullets
            </button>
            <button
              className={toolbarButtonClass(editor?.isActive("orderedList"))}
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

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-[#CFC5DA] bg-white px-4 text-sm font-semibold text-[#4B3861] transition-colors hover:bg-[#FBFAFC] disabled:cursor-not-allowed disabled:text-[#A79AB4]"
          data-testid="document-editor-save"
          disabled={isLoading || isSaving || !editor || !state}
          onClick={() => {
            void saveDocument();
          }}
          type="button"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
        <button
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]"
          data-testid="document-editor-continue"
          disabled={!canContinue}
          onClick={() => {
            if (latestOutput) {
              onComplete(latestOutput);
            }
          }}
          type="button"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
