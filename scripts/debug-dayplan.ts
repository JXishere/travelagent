import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

async function querySpots(categories: string[], city: string, limit: number) {
  const poolSize = Math.min(limit * 4, 20);
  const { data, error } = await sb
    .from("spots")
    .select("*")
    .eq("city", city)
    .overlaps("categories", categories)
    .order("must_go", { ascending: false })
    .order("verified", { ascending: false })
    .limit(poolSize);

  if (error) { console.error("DB error:", error); return []; }
  const pool = (data ?? []) as any[];

  const isThinSpot = (s: any) =>
    (!s.what_to_order || s.what_to_order.length === 0) &&
    !s.opening_hours &&
    (!s.pro_tips || s.pro_tips.length === 0);

  const mustGo = pool.filter(s => s.must_go).sort(() => Math.random() - 0.5);
  const verified = pool.filter(s => !s.must_go && s.verified).sort(() => Math.random() - 0.5);
  const rest = pool.filter(s => !s.must_go && !s.verified).sort(() => Math.random() - 0.5);
  const sorted = [...mustGo, ...verified, ...rest];
  const thick = sorted.filter(s => !isThinSpot(s));
  const thin = sorted.filter(s => isThinSpot(s));
  const result = (thick.length > 0 ? thick : thin).slice(0, limit);

  console.log(`  [${categories.join("/")}] pool=${pool.length}, thick=${thick.length}, thin=${thin.length}, returned=${result.length}`);
  return result;
}

async function main() {
  const city = "Kuala Lumpur";
  const [breakfast, lunch, activity, dinner] = await Promise.all([
    querySpots(["breakfast", "cafe"], city, 3),
    querySpots(["lunch"], city, 3),
    querySpots(["activity", "market"], city, 3),
    querySpots(["dinner"], city, 3),
  ]);

  console.log("Breakfast spots:", breakfast.map((s: any) => `${s.name} (${s.area})`));
  console.log("Lunch spots:", lunch.map((s: any) => `${s.name} (${s.area})`));
  console.log("Activity spots:", activity.map((s: any) => `${s.name} (${s.area})`));
  console.log("Dinner spots:", dinner.map((s: any) => `${s.name} (${s.area})`));
  console.log("Total allDaySpots:", breakfast.length + lunch.length + activity.length + dinner.length);
}

main().catch(console.error);
