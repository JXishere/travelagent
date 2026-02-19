"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessages, type Message } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { DAILY_LIMIT } from "@/lib/rate-limit";

function getOrCreateSessionId(): string {
  const key = "sam-session-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function ChatPanel({
  initialQuery,
  initialMessages: seedMessages,
  onClose,
  variant = "page",
}: {
  initialQuery?: string;
  initialMessages?: Message[];
  onClose?: () => void;
  variant?: "page" | "panel";
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionIdRef = useRef<string>("");
  const initialSent = useRef(false);

  useEffect(() => {
    if (initialQuery || seedMessages) {
      // Arriving with a query or seed messages — start fresh
      const newId = crypto.randomUUID();
      localStorage.setItem("sam-session-id", newId);
      sessionIdRef.current = newId;
      if (seedMessages) {
        setMessages(seedMessages);
        // Initialize contribution flow in DB so first message routes correctly
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: newId, initFlow: "contribution" }),
        }).catch(() => {});
      }
    } else {
      sessionIdRef.current = getOrCreateSessionId();
      // Load existing conversation history
      fetch(`/api/chat?sessionId=${sessionIdRef.current}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.messages?.length) {
            setMessages(
              data.messages.map((m: { role: string; content: string }) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              }))
            );
          }
        })
        .catch(() => {}); // silently fail — empty chat is fine
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming) return;

      setMessages((prev) => [...prev, { role: "user", content: text, timestamp: Date.now() }]);
      setIsStreaming(true);

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
                `Hey, you've hit your ${DAILY_LIMIT} messages for today — I need a breather! Catch me on WhatsApp for unlimited chat.`,
              timestamp: Date.now(),
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
                  assistantAdded = true;
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: parsed.text, timestamp: Date.now() },
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
          { role: "assistant", content: errorMessage, timestamp: Date.now() },
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

  // Auto-send initial query
  useEffect(() => {
    if (initialQuery && !initialSent.current && sessionIdRef.current) {
      initialSent.current = true;
      sendMessage(initialQuery);
    }
  }, [initialQuery, sendMessage]);

  return (
    <div className={`flex flex-col ${variant === "page" ? "h-dvh" : "h-full"}`}>
      <header className="flex items-center justify-between px-4 py-2">
        <div>
          <a href="/" className="text-sm font-medium" style={{ color: "var(--green)" }}>
            Sam
          </a>
          <p className="text-xs" style={{ color: "var(--fg)", opacity: 0.5 }}>
            the friend who lives everywhere
          </p>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={newConversation}
              disabled={isStreaming}
              className="rounded-md px-3 py-2 text-xs transition-opacity hover:opacity-80 disabled:opacity-30"
              style={{ color: "var(--muted)" }}
            >
              new chat
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-md p-2.5 text-lg leading-none transition-opacity hover:opacity-80"
              style={{ color: "var(--muted)" }}
              aria-label="Close chat"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <ChatMessages messages={messages} isStreaming={isStreaming} />
      <ChatInput
        onSend={sendMessage}
        disabled={isStreaming}
        placeholder={seedMessages ? "tell Sam about a spot..." : "ask Sam..."}
      />
    </div>
  );
}
