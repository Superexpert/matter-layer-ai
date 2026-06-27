export type WorkflowStepDocumentError = {
  matterDocumentId: string;
  fileName?: string;
  code: string;
  message: string;
  userMessage: string;
};

export type WorkflowStepError = {
  code: string;
  message: string;
  userMessage: string;
  details?: unknown;
  documentErrors?: WorkflowStepDocumentError[];
};

export function workflowStepError(input: WorkflowStepError): WorkflowStepError {
  return {
    ...input,
    documentErrors: input.documentErrors?.map((documentError) => ({
      ...documentError,
    })),
  };
}
