// Insert only spots not already in the DB (avoids duplicates)
import { createClient } from "@supabase/supabase-js";
import { spots as klSpots } from "../packages/bot/src/seeds/kl-research.js";
import { spots as pjSpots } from "../packages/bot/src/seeds/pj-research.js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

async function main() {
  const { data: existing } = await sb.from("spots").select("name, city").in("city", ["Kuala Lumpur", "Petaling Jaya"]);
  const existingNames = new Set(existing!.map((s: any) => s.name.toLowerCase()));

  const allSpots = [...klSpots, ...pjSpots];
  const newSpots = allSpots.filter((s: any) => !existingNames.has(s.name.toLowerCase()));

  console.log(`Existing: ${existingNames.size} | Seed file: ${allSpots.length} | New to insert: ${newSpots.length}`);

  let inserted = 0;
  for (const spot of newSpots) {
    const source = (spot as any).source || "llm_research";
    const { error } = await sb.from("spots").insert({ ...spot, source });
    if (error) {
      console.error(`  Failed: ${(spot as any).name} — ${error.message}`);
    } else {
      console.log(`  ✓ ${(spot as any).name} (${(spot as any).area})`);
      inserted++;
    }
  }
  console.log(`\nInserted ${inserted} new spots.`);
}
main().catch(console.error);
