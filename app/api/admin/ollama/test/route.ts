import { isCurrentUserAdmin } from "@/services/auth";
import { testOllamaModel } from "@/services/ai/providers/ollama-setup";

function parseBody(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      baseUrl: "",
      model: "",
    };
  }

  const body = value as { baseUrl?: unknown; model?: unknown };

  return {
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
    model: typeof body.model === "string" ? body.model : "",
  };
}

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "Admin access is required." }, { status: 403 });
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const body = parseBody(rawBody);

  try {
    return Response.json(await testOllamaModel(body));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Matter Layer could not test Ollama.",
        ok: false,
      },
      { status: 400 },
    );
  }
}

