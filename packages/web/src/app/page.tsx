import { getCityStats, getDistinctCities } from "@/lib/supabase";
import { PromptInput } from "@/components/prompt-input";
import { RotatingCity } from "@/components/rotating-city";

export const revalidate = 60;

const GOAL = 500;

const DEFAULT_CITY = process.env.NEXT_PUBLIC_DEFAULT_CITY || "Kuala Lumpur";

export default async function Home() {
  const [stats, cities] = await Promise.all([
    getCityStats(DEFAULT_CITY),
    getDistinctCities(),
  ]);
  const pct = Math.min(Math.round((stats.spot_count / GOAL) * 100), 100);
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md space-y-10 text-center">
        {/* Headline */}
        <h1 className="text-2xl font-medium tracking-tight">
          Know a spot? Tell Sam.
        </h1>

        {/* Subhead */}
        <p style={{ color: "var(--muted)" }}>
          Sam is learning <RotatingCity cities={cities} />.
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
          href="/chat"
          className="inline-block rounded-lg px-8 py-3 text-sm font-semibold text-black transition-colors hover:opacity-90"
          style={{ backgroundColor: "var(--green)" }}
        >
          Chat with Sam
        </a>
      </div>
    </main>
  );
}
