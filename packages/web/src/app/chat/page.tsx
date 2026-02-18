"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatPanel } from "@/components/chat-panel";

function Chat() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? undefined;
  const mode = searchParams.get("mode");

  const seedMessages =
    mode === "contribute"
      ? [
          {
            role: "assistant" as const,
            content:
              "Nice, you know a spot? Tell me — name, area, and what makes it worth going to.",
            timestamp: Date.now(),
          },
        ]
      : undefined;

  return (
    <ChatPanel
      initialQuery={mode === "contribute" ? undefined : q}
      initialMessages={seedMessages}
      variant="page"
    />
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
