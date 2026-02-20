"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PromptInput } from "@/components/prompt-input";
import { LiveFeed } from "@/components/live-feed";
import { ChatPanel } from "@/components/chat-panel";
import { useMediaQuery } from "@/lib/use-media-query";
import { RotatingCity } from "@/components/rotating-city";
import type { Message } from "@/components/chat-messages";

export function HomeClient({
  stats,
  teasers,
  countries,
}: {
  stats: { spot_count: number };
  teasers: string[];
  countries: string[];
}) {
  const router = useRouter();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState<string | undefined>();
  const [panelSeedMessages, setPanelSeedMessages] = useState<Message[] | undefined>();
  const [panelKey, setPanelKey] = useState(0);

  const openPanel = useCallback(
    (query?: string) => {
      if (isDesktop) {
        setPanelQuery(query);
        setPanelSeedMessages(undefined);
        setPanelKey((k) => k + 1);
        setPanelOpen(true);
      } else {
        if (query) {
          router.push(`/chat?q=${encodeURIComponent(query)}`);
        } else {
          router.push("/chat");
        }
      }
    },
    [isDesktop, router]
  );

  const openContribute = useCallback(() => {
    if (isDesktop) {
      setPanelQuery(undefined);
      setPanelSeedMessages([
        {
          role: "assistant",
          content: "Nice, you know a spot? Tell me — name, area, and what makes it worth going to.",
          timestamp: Date.now(),
        },
      ]);
      setPanelKey((k) => k + 1);
      setPanelOpen(true);
    } else {
      router.push("/chat?mode=contribute");
    }
  }, [isDesktop, router]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  // Escape key closes panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelOpen) {
        closePanel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [panelOpen, closePanel]);

  return (
    <div className="flex min-h-dvh">
      <main className="flex flex-1 flex-col px-4 sm:px-6 transition-all duration-300">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md space-y-6 sm:space-y-10 text-center">
          {/* Tagline */}
          <p
            className="text-left text-sm uppercase tracking-widest"
            style={{ color: "var(--muted)" }}
          >
            The friend who lives everywhere
          </p>

          {/* Headline */}
          <h1 className="-mt-6 text-left text-2xl font-medium tracking-tight">
            Ask Sam. He'll sort you out.
          </h1>

          <p className="-mt-4 text-left text-sm" style={{ color: "var(--muted)" }}>
            Where to eat, what to do, how to plan it — for wherever you're going.
          </p>

          {/* Live feed */}
          <p
            className="-mt-6 text-left text-sm"
            style={{ color: "var(--green)" }}
          >
            <LiveFeed teasers={teasers} />
          </p>

          {/* Prompt input */}
          <PromptInput
            onSubmit={(q) => openPanel(q)}
            onContribute={openContribute}
          />

          {/* Spot count */}
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {stats.spot_count} spots and counting.
            {countries.length > 0 && <> Currently living in <RotatingCity cities={countries} suffix="." lowercase={false} /></>}
          </p>

          {/* WhatsApp teaser */}
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            WhatsApp coming soon.
          </p>
          </div>
        </div>

        <footer className="py-6 text-center text-xs" style={{ color: "var(--muted)" }}>
          <p className="mb-2 opacity-50">food · travel · everywhere</p>
          <a href="https://samiseverywhere.com" className="hover:opacity-70 transition-opacity">samiseverywhere.com</a>
          <span className="mx-2">·</span>
          <span>© 2026 Sam</span>
        </footer>
      </main>

      {/* Slide-out chat panel (desktop only) */}
      <aside
        className="hidden lg:flex flex-col overflow-hidden border-l transition-all duration-300"
        style={{
          width: panelOpen ? 480 : 0,
          borderColor: panelOpen ? "var(--bar-bg)" : "transparent",
        }}
      >
        {panelOpen && (
          <ChatPanel
            key={panelKey}
            initialQuery={panelQuery}
            initialMessages={panelSeedMessages}
            onClose={closePanel}
            variant="panel"
          />
        )}
      </aside>
    </div>
  );
}
