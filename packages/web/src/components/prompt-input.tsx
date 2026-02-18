"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PromptInput({
  onSubmit,
  onContribute,
}: {
  onSubmit?: (query: string) => void;
  onContribute?: () => void;
} = {}) {
  const [value, setValue] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (onSubmit) {
      onSubmit(trimmed);
    } else {
      router.push(`/chat?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const handleContribute = () => {
    if (onContribute) {
      onContribute();
    } else {
      router.push("/chat?q=I%20know%20a%20spot");
    }
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
        placeholder="what's on your mind?"
        rows={2}
        className="w-full resize-none rounded-xl border px-4 py-3 text-sm outline-none placeholder:opacity-40"
        style={{
          backgroundColor: "var(--bar-bg)",
          borderColor: "var(--bar-bg)",
          color: "var(--fg)",
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <button
          type="submit"
          disabled={!value.trim()}
          className="rounded-lg py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-30"
          style={{ backgroundColor: "var(--green)" }}
        >
          Ask Sam
        </button>
        <button
          type="button"
          onClick={handleContribute}
          className="rounded-lg border py-3 text-sm font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: "var(--bar-bg)", color: "var(--fg)" }}
        >
          Tell Sam
        </button>
      </div>
    </form>
  );
}
