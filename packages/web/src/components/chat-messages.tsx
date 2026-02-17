"use client";

import { useEffect, useRef } from "react";
import { ChatBubble } from "./chat-bubble";

export type Message = { role: "user" | "assistant"; content: string };

export function ChatMessages({
  messages,
  isStreaming,
}: {
  messages: Message[];
  isStreaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, messages[messages.length - 1]?.content]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            ask sam anything about kuala lumpur
          </p>
        </div>
      )}
      {messages.map((msg, i) => (
        <ChatBubble key={i} role={msg.role} content={msg.content} />
      ))}
      {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="flex justify-start mb-3">
          <div
            className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm"
            style={{ backgroundColor: "var(--bar-bg)", color: "var(--muted)" }}
          >
            ...
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
