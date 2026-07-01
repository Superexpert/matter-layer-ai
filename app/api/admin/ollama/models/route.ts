import { isCurrentUserAdmin } from "@/services/auth";
import { checkOllamaAvailability } from "@/services/ai/providers/ollama-setup";

function parseBaseUrl(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const body = value as { baseUrl?: unknown };

  return typeof body.baseUrl === "string" ? body.baseUrl : "";
}

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "Admin access is required." }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  try {
    const result = await checkOllamaAvailability(parseBaseUrl(body));

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        available: false,
        error:
          error instanceof Error
            ? error.message
            : "Matter Layer could not check Ollama.",
      },
      { status: 400 },
    );
  }
}

