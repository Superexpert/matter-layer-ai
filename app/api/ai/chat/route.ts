import { createAIService } from "@/services/ai";
import type { AIMessage } from "@/services/ai";
import { getSetupStatus } from "@/services/setup";
import { requireCurrentUser } from "@/services/users";

type ChatRequestBody = {
  matterId: string;
  messages: AIMessage[];
};

type ChatErrorResponse = {
  error: string;
};

const CHAT_SYSTEM_MESSAGE: AIMessage = {
  role: "system",
  content: "You are Matter Layer, an AI assistant helping with a legal matter.",
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message } satisfies ChatErrorResponse, {
    status,
  });
}

function isAIMessage(value: unknown): value is AIMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<AIMessage>;

  return (
    (message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

function parseChatRequestBody(value: unknown): ChatRequestBody | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const body = value as Partial<ChatRequestBody>;

  if (typeof body.matterId !== "string" || !body.matterId.trim()) {
    return null;
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return null;
  }

  if (!body.messages.every(isAIMessage)) {
    return null;
  }

  return {
    matterId: body.matterId.trim(),
    messages: body.messages.map((message) => ({
      content: message.content.trim(),
      role: message.role,
    })),
  };
}

export async function POST(request: Request) {
  const setupStatus = await getSetupStatus({ verifyDatabase: true });

  if (!setupStatus.ready) {
    return jsonError(
      "Matter Layer setup is incomplete. Complete the setup page before using chat.",
      503,
    );
  }

  try {
    await requireCurrentUser();
  } catch {
    return jsonError("Authentication is required.", 401);
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const body = parseChatRequestBody(rawBody);

  if (!body) {
    return jsonError("Request body must include matterId and messages.", 400);
  }

  try {
    const aiService = createAIService();
    const response = await aiService.generateText({
      messages: [CHAT_SYSTEM_MESSAGE, ...body.messages],
    });

    return Response.json({
      message: {
        role: "assistant",
        content: response.content,
      } satisfies AIMessage,
      model: response.model,
      provider: response.provider,
    });
  } catch {
    return jsonError(
      "Matter Layer could not generate a response. Check your AI provider configuration and try again.",
      500,
    );
  }
}
