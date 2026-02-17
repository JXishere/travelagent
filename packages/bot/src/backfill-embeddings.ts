// Backfill embeddings for all spots that don't have one yet
// Usage: npm run backfill-embeddings -w @sam/bot

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding, buildSpotText } from "./embeddings.js";
import type { Spot } from "./database.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

async function backfill() {
  // Fetch spots missing embeddings
  const { data: spots, error } = await supabase
    .from("spots")
    .select("*")
    .is("embedding", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch spots:", error);
    process.exit(1);
  }

  if (!spots?.length) {
    console.log("All spots already have embeddings.");
    return;
  }

  console.log(`Found ${spots.length} spots without embeddings. Starting backfill...`);

  let success = 0;
  let failed = 0;

  for (const spot of spots as Spot[]) {
    const text = buildSpotText(spot);
    try {
      const embedding = await generateEmbedding(text);
      const embeddingStr = `[${embedding.join(",")}]`;

      const { error: updateError } = await supabase
        .from("spots")
        .update({ embedding: embeddingStr })
        .eq("id", spot.id);

      if (updateError) {
        console.error(`  Failed to update ${spot.name}:`, updateError.message);
        failed++;
      } else {
        success++;
        console.log(`  [${success}/${spots.length}] ${spot.name}`);
      }

      // Rate limit: OpenAI allows 3000 RPM for text-embedding-3-small
      // Be conservative with a small delay
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`  Failed to embed ${spot.name}:`, err);
      failed++;
    }
  }

  console.log(`\nDone. ${success} embedded, ${failed} failed.`);
}

backfill().catch(console.error);
