"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SignOutButton } from "@/app/components/SignOutButton";
import { AppContainer } from "@/components/app-container";
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

const actionCards = [
  {
    title: "Ask about this matter",
  },
  {
    title: "Start a workflow",
  },
  {
    title: "Add documents",
  },
];

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
      className="-mx-6 -my-8 min-h-screen bg-[#F7F6FA] text-[#211B27] sm:-mx-8 lg:-mx-10"
      data-testid="matter-chat"
    >
      <header
        className="border-b border-[#312342] bg-[#42305B]"
        data-testid="matter-workspace-header"
      >
        <AppContainer className="flex h-14 items-center justify-between gap-4">
          <Link
            className="shrink-0 text-sm font-semibold tracking-[0.01em] text-white"
            href="/app/matters"
          >
            Matter Layer
          </Link>
          <div className="flex items-center gap-1">
            <Link
              className="rounded-lg px-3 py-2 text-sm font-medium text-[#E8E2F0] hover:bg-white/10 hover:text-white"
              href="/app/settings"
            >
              Settings
            </Link>
            <SignOutButton />
          </div>
        </AppContainer>
      </header>

      <nav
        aria-label="Breadcrumb"
        className="border-b border-[#E3DEEA] bg-white"
        data-testid="matter-breadcrumb"
      >
        <AppContainer>
          <ol className="flex h-10 items-center gap-2 text-sm">
          <li>
            <Link
              className="font-medium text-[#5F4B76] hover:text-[#42305B]"
              data-testid="breadcrumb-home"
              href="/app/matters"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true" className="text-[#A79AB4]">
            /
          </li>
          <li
            aria-current="page"
            className="truncate font-semibold text-[#211B27]"
            data-testid="breadcrumb-current-matter"
          >
            {matterName}
          </li>
          </ol>
        </AppContainer>
      </nav>

      <nav
        aria-label="Matter navigation"
        className="border-b border-[#E3DEEA] bg-white"
        data-testid="matter-tabs"
      >
        <AppContainer className="flex h-11 items-center">
          {["Chat", "Workflows", "Documents"].map((tab, index) => (
            <button
              aria-current={tab === "Chat" ? "page" : undefined}
              className={
                tab === "Chat"
                  ? "h-11 border-b-2 border-[#5F4B76] pr-4 text-sm font-semibold text-[#4B3861]"
                  : `h-11 text-sm font-medium text-[#74677F] transition-colors hover:text-[#211B27] ${
                      index === 0 ? "pr-4" : "px-4"
                    }`
              }
              data-testid={`matter-tab-${tab.toLowerCase()}`}
              key={tab}
              type="button"
            >
              {tab}
            </button>
          ))}
        </AppContainer>
      </nav>

      <AppContainer className="grid min-h-[calc(100vh-8.75rem)] gap-4 py-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section
          className="flex min-h-[40rem] flex-col rounded-[14px] border border-[#E3DEEA] bg-white shadow-[0_1px_2px_rgba(40,29,52,0.05)]"
          data-testid="chat-workspace-panel"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div
              className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4"
              data-testid="conversation-area"
            >
              {messages.length === 0 && !isPending ? (
                <div className="rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-3">
                  <div className="grid gap-3 lg:grid-cols-3">
                    {actionCards.map((card) => (
                      <button
                        className="rounded-lg border border-[#E3DEEA] bg-white p-3 text-left transition-colors hover:border-[#CFC5DA] hover:bg-[#FBFAFC]"
                        key={card.title}
                        type="button"
                      >
                        <span className="block text-sm font-semibold text-[#211B27]">
                          {card.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((chatMessage) => (
                <article
                  className={
                    chatMessage.role === "user"
                      ? "ml-auto max-w-[78%] rounded-xl rounded-br-md bg-[#4B3861] px-4 py-3 text-sm leading-6 text-white"
                      : "mr-auto max-w-[78%] rounded-xl rounded-bl-md border border-[#E3DEEA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#211B27]"
                  }
                  data-testid={`chat-message-${chatMessage.role}`}
                  key={chatMessage.id}
                >
                  <p className="whitespace-pre-wrap">{chatMessage.content}</p>
                </article>
              ))}

              {isPending ? (
                <article
                  className="mr-auto max-w-[78%] rounded-xl rounded-bl-md border border-[#E3DEEA] bg-[#FBFAFC] px-4 py-3 text-sm leading-6 text-[#74677F]"
                  data-testid="assistant-thinking"
                >
                  Matter Layer is thinking...
                </article>
              ) : null}

              {errorMessage ? (
                <p
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
                  data-testid="chat-error"
                  role="alert"
                >
                  {errorMessage}
                </p>
              ) : null}

              <div ref={conversationEndRef} />
            </div>
          </div>

          <div className="border-t border-[#E3DEEA] bg-[#FBFAFC] px-5 py-4">
            <form
              className="rounded-xl border border-[#CFC5DA] bg-white p-3 shadow-[0_1px_2px_rgba(40,29,52,0.05)]"
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
                className="min-h-[10rem] w-full resize-none rounded-lg border-0 bg-transparent px-1 py-1 text-sm leading-6 text-[#211B27] outline-none placeholder:text-[#74677F]"
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
                rows={7}
                value={draftMessage}
              />
              <div className="mt-3 flex justify-end">
                <button
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861] disabled:cursor-not-allowed disabled:bg-[#CFC5DA]"
                  data-testid="send-message-button"
                  disabled={isPending || !draftMessage.trim()}
                  type="submit"
                >
                  {isPending ? "Sending" : "Send"}
                </button>
              </div>
            </form>
          </div>
        </section>

        <aside
          className="rounded-[14px] border border-[#E3DEEA] bg-white p-4 shadow-[0_1px_2px_rgba(40,29,52,0.05)]"
          data-testid="matter-context-panel"
        >
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
              Matter Context
            </p>
            <h2 className="mt-2 text-base font-semibold text-[#211B27]">
              {matterName}
            </h2>
          </div>

          <dl className="mt-4 grid gap-3">
            <div className="flex items-center justify-between border-t border-[#E3DEEA] pt-3">
              <dt className="text-sm text-[#74677F]">Status</dt>
              <dd className="rounded-md bg-[#F0EBF5] px-2 py-1 text-xs font-semibold text-[#4B3861]">
                Open
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-[#E3DEEA] pt-3">
              <dt className="text-sm text-[#74677F]">Documents</dt>
              <dd className="text-sm font-semibold text-[#211B27]">0</dd>
            </div>
            <div className="flex items-center justify-between border-t border-[#E3DEEA] pt-3">
              <dt className="text-sm text-[#74677F]">Workflows</dt>
              <dd className="text-sm font-semibold text-[#211B27]">0</dd>
            </div>
          </dl>

          <div className="mt-5 rounded-xl border border-[#E3DEEA] bg-[#FBFAFC] p-3">
            <h3 className="text-sm font-semibold text-[#211B27]">
              Matter boundary
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#74677F]">
              AI access is scoped to this matter.
            </p>
          </div>
        </aside>
      </AppContainer>
    </section>
  );
}
