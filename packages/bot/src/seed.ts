// Seed script — populate the knowledge graph with real spots
// Run with: npm run seed          (defaults to KL)
//           npm run seed Penang   (seed a specific city)

import { createClient } from "@supabase/supabase-js";
import { spots as klSpots } from "./seeds/kl.js";
import { spots as penangSpots } from "./seeds/penang.js";
import { spots as pjSpots } from "./seeds/pj.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

async function loadResearchSpots(): Promise<any[]> {
  const results: any[] = [];
  // @ts-ignore — optional seed files that may not exist
  try { results.push(...(await import("./seeds/kl-research.js")).spots); } catch {}
  // @ts-ignore — optional seed files that may not exist
  try { results.push(...(await import("./seeds/pj-research.js")).spots); } catch {}
  return results;
}

async function seed() {
  const researchSpots = await loadResearchSpots();
  const ALL_SPOTS = [...klSpots, ...penangSpots, ...pjSpots, ...researchSpots];
  const city = process.argv[2] || "Kuala Lumpur";
  const citySpots = ALL_SPOTS.filter((s) => s.city === city);

  if (citySpots.length === 0) {
    console.log(`No seed data for "${city}". Available cities: ${[...new Set(ALL_SPOTS.map((s) => s.city))].join(", ")}`);
    return;
  }

  console.log(`Seeding ${citySpots.length} ${city} spots...`);

  for (const spot of citySpots) {
    // Try with source column first; fall back without if column doesn't exist yet
    const source = (spot as any).source || "seed";
    let { error } = await supabase.from("spots").insert({ ...spot, source });
    if (error?.message?.includes("source")) {
      ({ error } = await supabase.from("spots").insert(spot));
    }
    if (error) {
      console.error(`Failed to insert ${spot.name}:`, error.message);
    } else {
      console.log(`  ✓ ${spot.name} (${spot.area || (spot as any).neighborhood})`);
    }
  }

  console.log("\nDone! Run some test queries to verify.");
}

seed().catch(console.error);
