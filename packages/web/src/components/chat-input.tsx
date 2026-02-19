"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function ChatInput({
  onSend,
  disabled,
  placeholder = "ask Sam...",
}: {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  // Re-focus textarea when streaming ends (disabled goes false)
  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      const max = 80; // ~3 lines, then scroll
      el.style.height = Math.min(el.scrollHeight, max) + "px";
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    }
  };

  return (
    <div
      className="border-t px-4 py-3"
      style={{ borderColor: "var(--bar-bg)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm outline-none placeholder:opacity-40"
          style={{
            backgroundColor: "var(--bar-bg)",
            borderColor: "var(--bar-bg)",
            color: "var(--fg)",
          }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="rounded-xl px-4 py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-30"
          style={{ backgroundColor: "var(--green)" }}
        >
          send
        </button>
      </div>
    </div>
  );
}
