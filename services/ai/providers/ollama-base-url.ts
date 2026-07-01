import { OLLAMA_DEFAULT_BASE_URL } from "../provider-registry";

export function normalizeOllamaBaseUrl(value: string | null | undefined) {
  const rawBaseUrl = value?.trim() || OLLAMA_DEFAULT_BASE_URL;
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("Ollama server URL must be a valid http or https URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Ollama server URL must use http or https.");
  }

  // Law firms can point Matter Layer to an internal Ollama server, for example:
  // http://matterlayer-ai.internal:11434. Localhost does not require HTTPS, and
  // internal HTTP remains allowed for early intranet deployments.
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString().replace(/\/$/, "");
}
