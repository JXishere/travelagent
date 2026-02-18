import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

async function main() {
const { data, error } = await sb
  .from("spots")
  .select("city, area, category, tier, source, vibe, price_range, best_time_of_day, indoor_outdoor, confidence_score")
  .in("city", ["Kuala Lumpur", "Petaling Jaya"]);

if (error) { console.error(error); process.exit(1); }

// Area x Category matrix
console.log("=== AREA x CATEGORY MATRIX (KL + PJ) ===");
const matrix: Record<string, Record<string, number>> = {};
const allCats = new Set<string>();
for (const r of data!) {
  const area = r.area || "unknown";
  if (!(area in matrix)) matrix[area] = {};
  const cat = r.category || "unknown";
  allCats.add(cat);
  matrix[area][cat] = (matrix[area][cat] || 0) + 1;
}
const cats = [...allCats].sort();
const areasSorted = Object.entries(matrix).sort((a, b) => {
  const totalA = Object.values(a[1]).reduce((s: number, n) => s + (n as number), 0);
  const totalB = Object.values(b[1]).reduce((s: number, n) => s + (n as number), 0);
  return totalB - totalA;
});
console.log("Area".padEnd(25) + cats.map(c => c.padEnd(12)).join("") + "TOTAL");
for (const [area, catMap] of areasSorted) {
  const total = Object.values(catMap).reduce((s: number, n) => s + (n as number), 0);
  const row = area.padEnd(25) + cats.map(c => String(catMap[c] || 0).padEnd(12)).join("") + total;
  console.log(row);
}

// Vibe distribution
console.log("\n=== VIBE DISTRIBUTION ===");
const vibes: Record<string, number> = {};
for (const r of data!) { const v = r.vibe || "null"; vibes[v] = (vibes[v] || 0) + 1; }
console.table(vibes);

// Price range distribution
console.log("\n=== PRICE RANGE ===");
const prices: Record<string, number> = {};
for (const r of data!) { const p = r.price_range || "null"; prices[p] = (prices[p] || 0) + 1; }
console.table(prices);

// Tier distribution
console.log("\n=== TIER ===");
const tiers: Record<string, number> = {};
for (const r of data!) { const t = String(r.tier ?? "null"); tiers[t] = (tiers[t] || 0) + 1; }
console.table(tiers);

// Source x City
console.log("\n=== SOURCE x CITY ===");
const srcCity: Record<string, number> = {};
for (const r of data!) {
  const key = r.city + " | " + (r.source || "null");
  srcCity[key] = (srcCity[key] || 0) + 1;
}
console.table(srcCity);

// Best time of day
console.log("\n=== BEST TIME OF DAY ===");
const btod: Record<string, number> = {};
for (const r of data!) { const b = r.best_time_of_day || "null"; btod[b] = (btod[b] || 0) + 1; }
console.table(btod);

// Category x tier cross
console.log("\n=== CATEGORY x TIER ===");
const catTier: Record<string, Record<string, number>> = {};
for (const r of data!) {
  const cat = r.category || "unknown";
  const tier = String(r.tier ?? "null");
  if (!(cat in catTier)) catTier[cat] = {};
  catTier[cat][tier] = (catTier[cat][tier] || 0) + 1;
}
for (const [cat, tierMap] of Object.entries(catTier).sort()) {
  const parts = Object.entries(tierMap).sort().map(([t, c]) => `T${t}=${c}`).join(", ");
  console.log(`  ${cat}: ${parts}`);
}

console.log("\nTotal KL+PJ:", data!.length);
}
main().catch(console.error);
