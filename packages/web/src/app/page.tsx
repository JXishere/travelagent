import { getCityStats } from "@/lib/supabase";
import { PromptInput } from "@/components/prompt-input";

export const revalidate = 60;

const GOAL = 500;

export default async function Home() {
  const stats = await getCityStats("Kuala Lumpur");
  const pct = Math.min(Math.round((stats.spot_count / GOAL) * 100), 100);
  const whatsappNumber = process.env.ADMIN_PHONE_NUMBER || "";
  const waLink = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent("I know a spot")}`;

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md space-y-10 text-center">
        {/* Headline */}
        <h1 className="text-2xl font-medium tracking-tight">
          know a spot. tell sam.
        </h1>

        {/* Subhead */}
        <p style={{ color: "var(--muted)" }}>
          sam is learning kuala lumpur.
        </p>

        {/* Prompt input */}
        <PromptInput />

        {/* Progress bar */}
        <div className="space-y-3">
          <div
            className="h-3 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--bar-bg)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                backgroundColor: "var(--green)",
              }}
            />
          </div>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {stats.spot_count} / {GOAL}
          </p>
        </div>

        {/* CTA */}
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg px-8 py-3 text-sm font-semibold text-black transition-colors hover:opacity-90"
          style={{ backgroundColor: "var(--green)" }}
        >
          tell sam what you know
        </a>
      </div>
    </main>
  );
}
