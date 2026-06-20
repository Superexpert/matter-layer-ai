import { createAIService } from "@/services/ai";
import type { AIMessage, AIStreamEvent } from "@/services/ai";
import { AISettingsConfigurationError } from "@/services/ai/ai-settings-service";
import { getSetupStatus } from "@/services/setup";
import { requireCurrentUser } from "@/services/users";
import { UserRole } from "@prisma/client";

type ChatRequestBody = {
  matterId: string;
  messages: AIMessage[];
};

type ChatErrorResponse = {
  error: string;
  redirectTo?: string;
};

type ChatStreamEvent =
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "done";
      message: {
        role: "assistant";
        content: string;
        provider: string;
        model: string;
      };
    }
  | {
      type: "error";
      error: string;
    };

const CHAT_SYSTEM_MESSAGE: AIMessage = {
  role: "system",
  content: "You are Matter Layer, an AI assistant helping with a legal matter.",
};

function jsonError(message: string, status: number, redirectTo?: string) {
  return Response.json({ error: message, redirectTo } satisfies ChatErrorResponse, {
    status,
  });
}

function encodeStreamEvent(event: ChatStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function toChatStreamEvent(event: AIStreamEvent): ChatStreamEvent {
  if (event.type === "text-delta") {
    return {
      delta: event.delta,
      type: "text-delta",
    };
  }

  if (event.type === "done") {
    return {
      message: {
        content: event.response.content,
        model: event.response.model,
        provider: event.response.provider,
        role: "assistant",
      },
      type: "done",
    };
  }

  return {
    error: event.error,
    type: "error",
  };
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

  let currentUser;

  try {
    currentUser = await requireCurrentUser();
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
    const aiService = await createAIService();
    const stream = aiService.streamText({
      messages: [CHAT_SYSTEM_MESSAGE, ...body.messages],
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          try {
            for await (const event of stream) {
              controller.enqueue(encoder.encode(encodeStreamEvent(toChatStreamEvent(event))));
            }
          } catch {
            controller.enqueue(
              encoder.encode(
                encodeStreamEvent({
                  error:
                    "Matter Layer could not generate a response. Check your AI provider configuration and try again.",
                  type: "error",
                }),
              ),
            );
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error) {
    if (error instanceof AISettingsConfigurationError) {
      if (currentUser.role === UserRole.ADMIN) {
        return jsonError(
          "AI provider settings are not configured.",
          409,
          "/app/admin",
        );
      }

      return jsonError(
        "AI has not been configured yet. Please contact an administrator.",
        503,
      );
    }

    return jsonError(
      "Matter Layer could not generate a response. Check your AI provider configuration and try again.",
      500,
    );
  }
}
