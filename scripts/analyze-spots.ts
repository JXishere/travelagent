import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

async function main() {
const { data, error } = await sb
  .from("spots")
  .select("city, area, categories, must_go, verified, source, vibe, price_range, best_time_of_day, indoor_outdoor")
  .in("city", ["Kuala Lumpur", "Petaling Jaya"]);

if (error) { console.error(error); process.exit(1); }

// Area x Category matrix
console.log("=== AREA x CATEGORY MATRIX (KL + PJ) ===");
const matrix: Record<string, Record<string, number>> = {};
const allCats = new Set<string>();
for (const r of data!) {
  const area = r.area || "unknown";
  if (!(area in matrix)) matrix[area] = {};
  const cat = r.categories?.[0] || "unknown";
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

// Quality distribution
console.log("\n=== QUALITY (must_go / verified) ===");
const quality: Record<string, number> = { must_go: 0, verified: 0, standard: 0 };
for (const r of data!) {
  if (r.must_go) quality.must_go++;
  else if (r.verified) quality.verified++;
  else quality.standard++;
}
console.table(quality);

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

// Category x quality cross
console.log("\n=== CATEGORY x QUALITY ===");
const catQuality: Record<string, Record<string, number>> = {};
for (const r of data!) {
  const cat = r.categories?.[0] || "unknown";
  if (!(cat in catQuality)) catQuality[cat] = {};
  const q = r.must_go ? "must_go" : (r.verified ? "verified" : "standard");
  catQuality[cat][q] = (catQuality[cat][q] || 0) + 1;
}
for (const [cat, qualMap] of Object.entries(catQuality).sort()) {
  const parts = Object.entries(qualMap).sort().map(([q, c]) => `${q}=${c}`).join(", ");
  console.log(`  ${cat}: ${parts}`);
}

console.log("\nTotal KL+PJ:", data!.length);
}
main().catch(console.error);
