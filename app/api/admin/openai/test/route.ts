import { isCurrentUserAdmin } from "@/services/auth";
import { testSavedOpenAIProviderConfig } from "@/services/ai/ai-settings-service";

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "Admin access is required.", ok: false }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON.", ok: false }, { status: 400 });
  }
  const configId = body && typeof body === "object" && typeof (body as { configId?: unknown }).configId === "string"
    ? (body as { configId: string }).configId.trim()
    : "";
  if (!configId) return Response.json({ error: "AI provider config id is required.", ok: false }, { status: 400 });
  return Response.json(await testSavedOpenAIProviderConfig(configId));
}
