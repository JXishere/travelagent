"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatBubble } from "./chat-bubble";

export type Message = { role: "user" | "assistant"; content: string; timestamp?: number };

export function ChatMessages({
  messages,
  isStreaming,
}: {
  messages: Message[];
  isStreaming: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolledUp(false);
  }, []);

  // Auto-scroll when new content arrives (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, messages[messages.length - 1]?.content, userScrolledUp]);

  // Track scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      setUserScrolledUp(!isNearBottom());
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [isNearBottom]);

  return (
    <div ref={containerRef} className="relative flex-1 overflow-y-auto px-4 py-6">
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm" style={{ color: "var(--muted)", opacity: 0.5 }}>
            ask Sam anything
          </p>
        </div>
      )}
      {messages.map((msg, i) => (
        <ChatBubble key={i} role={msg.role} content={msg.content} timestamp={msg.timestamp} />
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

      {userScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs shadow-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--bar-bg)", color: "var(--muted)" }}
        >
          ↓ scroll down
        </button>
      )}
    </div>
  );
}
