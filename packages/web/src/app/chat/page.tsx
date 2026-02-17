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

      // Add empty assistant message that we'll stream into
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            message: text,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error("Failed to connect");
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
            } catch {
              // skip malformed chunks
            }
          }
        }
      } catch (error) {
        console.error("Chat error:", error);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && !last.content) {
            updated[updated.length - 1] = {
              ...last,
              content: "Sorry, something went wrong. Try again?",
            };
          }
          return updated;
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming]
  );

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
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          kuala lumpur
        </span>
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
