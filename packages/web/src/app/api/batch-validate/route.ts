import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { webSearchSpot } from "@sam/bot/llm";

function computeConfidenceScore(spot: Record<string, unknown>): number {
  let score = 0;
  if (Array.isArray(spot.what_to_order) && spot.what_to_order.length > 0) score += 25;
  if (Array.isArray(spot.pro_tips) && spot.pro_tips.length > 0) score += 20;
  if (spot.address) score += 15;
  if (spot.vibe) score += 10;
  if (spot.price_range) score += 10;
  if (spot.best_time_of_day) score += 10;
  if (Array.isArray(spot.categories) && spot.categories.length > 0) score += 10;
  return score;
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: "No Supabase config" }), { status: 500 });
  }

  const url = req.nextUrl;
  const city = url.searchParams.get("city") ?? undefined;
  const thinOnly = url.searchParams.get("thin_only") !== "false";
  const unverifiedOnly = url.searchParams.get("unverified_only") !== "false";

  const supabase = createClient(supabaseUrl, supabaseKey);

  let query = supabase
    .from("spots")
    .select("id, name, city, categories, what_to_order, pro_tips, address, vibe, price_range, best_time_of_day, verified");

  if (city) query = query.eq("city", city);
  if (unverifiedOnly) query = query.eq("verified", false);

  const { data: allSpots, error } = await query.order("name");

  if (error || !allSpots) {
    return new Response(JSON.stringify({ error: error?.message ?? "Query failed" }), { status: 500 });
  }

  // Filter thin spots client-side (no what_to_order AND no pro_tips)
  const spots = thinOnly
    ? allSpots.filter((s: Record<string, unknown>) => {
        const noOrder = !Array.isArray(s.what_to_order) || (s.what_to_order as unknown[]).length === 0;
        const noTips = !Array.isArray(s.pro_tips) || (s.pro_tips as unknown[]).length === 0;
        return noOrder && noTips;
      })
    : allSpots;

  const total = spots.length;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(enc.encode(JSON.stringify(payload) + "\n"));
      };

      // Send total count immediately so the UI can show the progress bar
      send({ done: 0, total, name: "" });

      let done = 0;

      for (const spot of spots) {
        try {
          const suggestions = await webSearchSpot(
            spot.name as string,
            (spot.city as string) ?? "Kuala Lumpur"
          );

          // Merge: fill empty fields only — never overwrite existing data
          const updates: Record<string, unknown> = {};

          const existingOrder = spot.what_to_order as string[] | null;
          const existingTips = spot.pro_tips as string[] | null;
          const suggestionsTyped = suggestions as Record<string, unknown>;

          if (
            (!existingOrder || existingOrder.length === 0) &&
            Array.isArray(suggestionsTyped.what_to_order) &&
            (suggestionsTyped.what_to_order as unknown[]).length > 0
          ) {
            updates.what_to_order = suggestionsTyped.what_to_order;
          }
          if (
            (!existingTips || existingTips.length === 0) &&
            Array.isArray(suggestionsTyped.pro_tips) &&
            (suggestionsTyped.pro_tips as unknown[]).length > 0
          ) {
            updates.pro_tips = suggestionsTyped.pro_tips;
          }
          if (!spot.address && suggestionsTyped.address) {
            updates.address = suggestionsTyped.address;
          }
          if (!spot.vibe && suggestionsTyped.vibe) {
            updates.vibe = suggestionsTyped.vibe;
          }
          if (!spot.price_range && suggestionsTyped.price_range) {
            updates.price_range = suggestionsTyped.price_range;
          }

          // Compute confidence score from merged state
          const merged = { ...spot, ...updates };
          updates.confidence_score = computeConfidenceScore(merged as Record<string, unknown>);

          await supabase.from("spots").update(updates).eq("id", spot.id);
        } catch (err) {
          console.error("Validation failed for", spot.name, err);
          // Still record a confidence score for the spot as-is
          const fallbackScore = computeConfidenceScore(spot as Record<string, unknown>);
          await supabase
            .from("spots")
            .update({ confidence_score: fallbackScore })
            .eq("id", spot.id);
        }

        done++;
        send({ done, total, name: spot.name as string });

        // Rate limit: 1.5s between Claude API calls
        if (done < total) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
