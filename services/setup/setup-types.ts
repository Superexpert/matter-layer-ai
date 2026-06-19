export type SetupArea = "google-oauth" | "database" | "ai-provider";

export type SetupCheckStatus = "ready" | "missing" | "invalid";

export type SetupCheckResult = {
  area: SetupArea;
  status: SetupCheckStatus;
  missingEnvVars: string[];
  message?: string;
};

export type SetupStatus = {
  ready: boolean;
  firstBlockingArea?: SetupArea;
  checks: SetupCheckResult[];
};
