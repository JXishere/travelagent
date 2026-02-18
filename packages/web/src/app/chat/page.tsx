"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChatMessages, type Message } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";

function getOrCreateSessionId(): string {
  const key = "sam-session-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function Chat() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionIdRef = useRef<string>("");
  const initialSent = useRef(false);

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming) return;

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsStreaming(true);

      // Don't add empty assistant message yet — let typing indicator show
      let assistantAdded = false;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            message: text,
          }),
        });

        if (res.status === 429) {
          const data = await res.json();
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                data.error ||
                "Hey, you've hit your 30 messages for today — I need a breather! Catch me on WhatsApp for unlimited chat.",
            },
          ]);
          return;
        }

        if (!res.ok || !res.body) {
          const isServerError = res.status >= 500;
          throw new Error(
            isServerError
              ? "Sam's taking a breather — try again in a moment."
              : "Failed to connect"
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                if (!assistantAdded) {
                  // Add assistant message on first chunk
                  assistantAdded = true;
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: parsed.text },
                  ]);
                } else {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.role === "assistant") {
                      updated[updated.length - 1] = {
                        ...last,
                        content: last.content + parsed.text,
                      };
                    }
                    return updated;
                  });
                }
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      } catch (error) {
        console.error("Chat error:", error);
        const isNetworkError =
          error instanceof TypeError && error.message === "Failed to fetch";
        const errorMessage = isNetworkError
          ? "Looks like you're offline — check your connection and try again."
          : error instanceof Error && error.message !== "Failed to connect"
            ? error.message
            : "Sam's taking a breather — try again in a moment.";

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: errorMessage },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming]
  );

  const newConversation = useCallback(() => {
    if (isStreaming) return;
    const newId = crypto.randomUUID();
    localStorage.setItem("sam-session-id", newId);
    sessionIdRef.current = newId;
    setMessages([]);
  }, [isStreaming]);

  // Auto-send initial query from search params
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !initialSent.current && sessionIdRef.current) {
      initialSent.current = true;
      sendMessage(q);
    }
  }, [searchParams, sendMessage]);

  return (
    <div className="flex h-dvh flex-col">
      <header
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--bar-bg)" }}
      >
        <a href="/" className="text-sm font-medium" style={{ color: "var(--green)" }}>
          sam
        </a>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {(process.env.NEXT_PUBLIC_DEFAULT_CITY || "Kuala Lumpur").toLowerCase()}
          </span>
          {messages.length > 0 && (
            <button
              onClick={newConversation}
              disabled={isStreaming}
              className="rounded-md px-2 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-30"
              style={{ backgroundColor: "var(--bar-bg)", color: "var(--muted)" }}
            >
              new chat
            </button>
          )}
        </div>
      </header>

      <ChatMessages messages={messages} isStreaming={isStreaming} />
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
