"use client";

import { useEffect, useRef, useState } from "react";

import type { AIMessage } from "@/services/ai/types";

type ChatMessage = AIMessage & {
  id: string;
};

type MatterChatProps = {
  matterId: string;
  matterName: string;
};

type ChatResponseBody = {
  message?: AIMessage;
};

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAssistantMessage(value: unknown): value is AIMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<AIMessage>;

  return message.role === "assistant" && typeof message.content === "string";
}

export function MatterChat({ matterId, matterName }: MatterChatProps) {
  const [draftMessage, setDraftMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const conversationEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isPending, errorMessage]);

  async function submitMessage() {
    const content = draftMessage.trim();

    if (!content || isPending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setDraftMessage("");
    setErrorMessage("");
    setIsPending(true);

    try {
      const response = await fetch("/api/ai/chat", {
        body: JSON.stringify({
          matterId,
          messages: nextMessages.map(({ content: messageContent, role }) => ({
            content: messageContent,
            role,
          })),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const responseBody = (await response.json()) as ChatResponseBody;

      if (!response.ok || !isAssistantMessage(responseBody.message)) {
        throw new Error("AI chat request failed.");
      }

      const assistantMessage = responseBody.message;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId(),
          content: assistantMessage.content.trim(),
          role: "assistant",
        },
      ]);
    } catch {
      setErrorMessage(
        "Matter Layer could not generate a response. Check your AI provider configuration and try again.",
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section
      className="flex h-[calc(100vh-10rem)] min-h-[34rem] flex-col bg-white shadow-sm ring-1 ring-zinc-200"
      data-testid="matter-chat"
    >
      <header className="border-b border-zinc-200 px-5 py-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Matter Layer
        </p>
        <h1 className="mt-1 text-xl font-semibold text-zinc-950 sm:text-2xl">
          {matterName}
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-[24rem] flex-1 overflow-y-auto px-5 py-8 sm:px-6"
          data-testid="conversation-area"
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5">
            {messages.length === 0 && !isPending ? (
              <div className="m-auto max-w-xl text-center">
                <h2 className="text-2xl font-semibold text-zinc-950">
                  Start working on this matter
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-600">
                  Ask a question, draft a document, or begin a workflow for this
                  matter.
                </p>
              </div>
            ) : null}

            {messages.map((chatMessage) => (
              <article
                className={
                  chatMessage.role === "user"
                    ? "ml-auto max-w-[85%] bg-[#263326] px-4 py-3 text-sm leading-6 text-white"
                    : "mr-auto max-w-[85%] bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-950"
                }
                data-testid={`chat-message-${chatMessage.role}`}
                key={chatMessage.id}
              >
                <p className="whitespace-pre-wrap">{chatMessage.content}</p>
              </article>
            ))}

            {isPending ? (
              <article
                className="mr-auto max-w-[85%] bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-600"
                data-testid="assistant-thinking"
              >
                Matter Layer is thinking...
              </article>
            ) : null}

            {errorMessage ? (
              <p
                className="border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
                data-testid="chat-error"
                role="alert"
              >
                {errorMessage}
              </p>
            ) : null}

            <div ref={conversationEndRef} />
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-zinc-200 bg-white px-4 py-4 sm:px-6">
          <form
            className="mx-auto flex max-w-3xl items-end gap-3"
            data-testid="message-composer"
            onSubmit={async (event) => {
              event.preventDefault();
              await submitMessage();
            }}
          >
            <label className="sr-only" htmlFor="matter-message">
              Message Matter Layer
            </label>
            <textarea
              className="max-h-48 min-h-14 flex-1 resize-y border border-zinc-300 px-4 py-3 text-sm leading-6 text-zinc-950 outline-none transition-colors placeholder:text-zinc-500 focus:border-[#5c6f47]"
              data-testid="message-textarea"
              disabled={isPending}
              id="matter-message"
              name="message"
              onChange={(event) => setDraftMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitMessage();
                }
              }}
              placeholder="Message Matter Layer..."
              rows={1}
              value={draftMessage}
            />
            <button
              className="inline-flex h-14 shrink-0 items-center justify-center bg-[#263326] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#344734] disabled:cursor-not-allowed disabled:bg-zinc-300"
              data-testid="send-message-button"
              disabled={isPending || !draftMessage.trim()}
              type="submit"
            >
              {isPending ? "Sending" : "Send"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
