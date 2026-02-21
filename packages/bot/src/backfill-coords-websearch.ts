// Backfill lat/lng for spots with null coordinates using Claude web search.
// Runs against the 68 spots that area-centroid averaging couldn't cover
// (areas where no other spot was already geocoded).
//
// Usage: npx tsx src/backfill-coords-websearch.ts [--dry-run]

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const client = new Anthropic();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = 1000; // 1s between calls — polite to the API

interface SpotRow {
  id: string;
  name: string;
  area: string | null;
  city: string;
  country: string;
}

/** Ask Claude (with web search) for the lat/lng of a named place */
async function lookupCoords(
  spot: SpotRow
): Promise<{ lat: number; lng: number } | null> {
  const location = [spot.area, spot.city, spot.country]
    .filter(Boolean)
    .join(", ");

  const systemPrompt = `You are a geocoding assistant. Given a place name and location, find its GPS coordinates.
Return ONLY a JSON object with this exact shape:
{ "latitude": <number>, "longitude": <number> }
If you cannot find the specific place, return null.
Do not include any other text or markdown fences.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Find the GPS coordinates of "${spot.name}" in ${location}.`,
        },
      ],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    });

    // Collect all text across all blocks — model often narrates before giving JSON
    const allText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");

    // Extract lat/lng via targeted regex — works whether the model wraps in prose or not
    const latMatch = allText.match(/"latitude"\s*:\s*(-?\d+\.?\d*)/);
    const lngMatch = allText.match(/"longitude"\s*:\s*(-?\d+\.?\d*)/);

    if (latMatch && lngMatch) {
      const lat = parseFloat(latMatch[1]);
      const lng = parseFloat(lngMatch[1]);
      if (lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
    return null;
  } catch (err) {
    console.error(`  [error] lookup failed for "${spot.name}":`, err);
    return null;
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\nBackfill coords via web search${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  // Fetch all spots with null coords
  const { data: spots, error } = await supabase
    .from("spots")
    .select("id, name, area, city, country")
    .is("latitude", null)
    .order("area", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  if (!spots || spots.length === 0) {
    console.log("No spots with null coordinates — nothing to do.");
    return;
  }

  console.log(`Found ${spots.length} spots with null coordinates.\n`);

  let found = 0;
  let skipped = 0;

  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i] as SpotRow;
    const prefix = `[${i + 1}/${spots.length}]`;
    const label = `${spot.name} (${spot.area ?? "?"}, ${spot.city})`;

    process.stdout.write(`${prefix} ${label} ... `);

    const coords = await lookupCoords(spot);

    if (!coords) {
      console.log("not found");
      skipped++;
    } else {
      console.log(`${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from("spots")
          .update({ latitude: coords.lat, longitude: coords.lng })
          .eq("id", spot.id);
        if (updateErr) console.error(`  [db error]`, updateErr);
      }
      found++;
    }

    if (i < spots.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. Found: ${found} | Not found: ${skipped} | Total: ${spots.length}`);
  if (DRY_RUN) console.log("(Dry run — no DB writes made)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
