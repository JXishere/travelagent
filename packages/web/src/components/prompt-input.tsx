"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PromptInput() {
  const [value, setValue] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(`/chat?q=${encodeURIComponent(trimmed)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="where should I eat in Bangsar?"
        rows={2}
        className="w-full resize-none rounded-xl border px-4 py-3 text-sm outline-none placeholder:opacity-40"
        style={{
          backgroundColor: "var(--bar-bg)",
          borderColor: "var(--bar-bg)",
          color: "var(--fg)",
        }}
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="w-full rounded-lg px-8 py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-30"
        style={{ backgroundColor: "var(--green)" }}
      >
        ask sam
      </button>
    </form>
  );
}
