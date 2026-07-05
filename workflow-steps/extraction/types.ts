export type ExtractionAIService = {
  generateText: (request: {
    maxOutputTokens?: number;
    messages: Array<{ content: string; role: "assistant" | "system" | "user" }>;
    responseFormat?: {
      name?: string;
      schema?: Record<string, unknown>;
      type: "json_object" | "json_schema";
    };
    temperature?: number;
  }) => Promise<{
    content: string;
    model: string;
    provider: string;
  }>;
};

export type ExtractionWarning = {
  code: string;
  factId?: string;
  itemId?: string;
  message: string;
  rawValue?: unknown;
  severity: "info" | "warning" | "error";
};

export type RejectedExtractionItem = {
  code: string;
  itemId?: string;
  message: string;
  rawValue?: unknown;
};

export type ExtractionMarkdownWindow = {
  documentId: string;
  fileName: string;
  markdown: string;
  pageEnd: number | null;
  pageStart: number | null;
  windowIndex: number;
};

export type ExtractionWindowProgressEvent = {
  documentId: string;
  elapsedMs?: number;
  error?: string;
  errorCode?: string;
  errorProvider?: string | null;
  errorStatus?: number | null;
  errorUserMessage?: string;
  extractedItemCount?: number;
  failedWindowCount: number;
  fileName: string;
  markdownCharacterCount?: number;
  pageEnd: number | null;
  pageStart: number | null;
  promptCharacterCount?: number;
  status: "completed" | "failed" | "started" | "waiting";
  timeoutMs?: number;
  windowCount: number;
  windowIndex: number;
};

export type ExtractionProfileContext = {
  aiCallTimeoutMs?: number;
  aiHeartbeatMs?: number;
  aiService: ExtractionAIService;
  onWindowProgress?: (
    event: ExtractionWindowProgressEvent,
  ) => Promise<void> | void;
  readyDocuments: Array<{
    fileName: string;
    id: string;
    markdown: string;
  }>;
};

export type ExtractionModelParseResult<TItem> = {
  itemCountsByType?: Record<string, number>;
  items: TItem[];
  warnings: ExtractionWarning[];
};

export type ExtractionRunStatus = "COMPLETED" | "FAILED" | "PARTIAL_FAILED";

export type ExtractionProfileRunResult<TItem = unknown> = {
  error: string | null;
  errorCode: string | null;
  errorProvider: string | null;
  errorStatus: number | null;
  errorUserMessage: string | null;
  failedWindowCount: number;
  itemCount: number;
  itemCountsByType: Record<string, number>;
  items: TItem[];
  model: string | null;
  provider: string | null;
  status: ExtractionRunStatus;
  warnings: ExtractionWarning[];
  windowCount: number;
};

export type ExtractionProfileArtifact = {
  content: string;
  metadataJson?: unknown;
  outputKey: string;
  title: string;
};

export type ExtractionProfilePostprocessResult = {
  artifactMetadata?: Record<string, unknown>;
  artifacts?: ExtractionProfileArtifact[];
  displayItems?: Array<Record<string, unknown>>;
  itemCount: number;
  itemCountsByType: Record<string, number>;
  profileOutput: unknown;
  stepOutputPatch?: {
    collapsedEventCount?: number;
    collapsedEvents?: Array<Record<string, unknown>>;
    extractedFactCount?: number;
    facts?: Array<Record<string, unknown>>;
    factsByType?: Record<string, number>;
  };
};

export type ExtractionProfileUICopy = {
  profileLine?: string | null;
  runButtonLabel?: string;
  runningButtonLabel?: string;
  retryButtonLabel?: string;
  runningDocumentLabel?: string;
  queuedDocumentMessage?: string;
};

export type ExtractionProfile<TItem = unknown> = {
  buildUserPrompt: (window: ExtractionMarkdownWindow) => string;
  createWindows?: (input: {
    documentId: string;
    fileName: string;
    markdown: string;
  }) => ExtractionMarkdownWindow[];
  description: string;
  id: string;
  itemLabel: string;
  itemPluralLabel: string;
  label: string;
  maxOutputTokens?: number;
  parseModelOutput: (
    content: string,
    context: {
      window: ExtractionMarkdownWindow;
    },
  ) => ExtractionModelParseResult<TItem>;
  postProcess?: (input: {
    items: TItem[];
    runResult: ExtractionProfileRunResult<TItem>;
  }) => ExtractionProfilePostprocessResult;
  responseFormat?: {
    name?: string;
    schema?: Record<string, unknown>;
    type: "json_object" | "json_schema";
  };
  jsonRepairInstructions?: string;
  systemPrompt: string;
  taskId?: string;
  ui?: ExtractionProfileUICopy;
};
