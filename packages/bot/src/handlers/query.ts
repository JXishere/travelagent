// Query flow — "I'm hungry near Bangsar" → spot recommendations from knowledge graph

import { chat, loadPrompt, HAIKU } from "../llm.js";
import { querySpots, semanticSearchSpots, incrementSpotUseCount, markSpotsVisited, getOrCreateTraveler, trackEvent, type Spot } from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { resolveCategories, DEFAULT_CATEGORIES } from "../utils/categories.js";
import { getDefaultCity } from "../utils/city-defaults.js";

let _systemPrompt: string | null = null;
function getSystemPrompt(): string {
  if (!_systemPrompt) _systemPrompt = loadPrompt("system");
  return _systemPrompt;
}

interface QueryDetails {
  neighborhood?: string;
  meal_type?: string;
  time_of_day?: string;
  mood?: string;
  specific_place?: string;
}

export async function handleQuery(
  phoneNumber: string,
  message: string,
  details: QueryDetails,
  travelerContext?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const channel = options?.channel ?? "whatsapp";
  const categories = resolveCategories(details.meal_type, details.time_of_day);
  const isDishQuery = categories === null;
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();
  const city = traveler.current_city ?? getDefaultCity();

  let spots: Spot[];

  if (isDishQuery) {
    // Dish query ("roti", "laksa") — semantic search first, no category filter
    spots = await trySemanticSearch(message, city);
    if (spots.length === 0) {
      // Fallback: broad food categories
      spots = await querySpots({
        city,
        neighborhood: details.neighborhood,
        categories: DEFAULT_CATEGORIES,
        indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
        limit: 5,
      });
    }
  } else {
    // Category query ("dinner", "breakfast") — structured first, semantic fallback
    spots = await querySpots({
      city,
      neighborhood: details.neighborhood,
      categories,
      indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
      limit: 5,
    });
    if (spots.length === 0) {
      spots = await trySemanticSearch(message, city);
    }
  }

  if (spots.length === 0) {
    return await chat(
      getSystemPrompt(),
      [
        {
          role: "user",
          content: `The user says: "${message}"\n\nYou have NO spots in your knowledge graph for this query. Do NOT make up or suggest any restaurants, cafes, or places. Be honest that you don't have intel on this yet. Keep it short — this is WhatsApp.`,
        },
      ],
      { maxTokens: 512, model: HAIKU }
    );
  }

  // Track usage and mark as visited
  const topSpots = spots.slice(0, 3);
  for (const spot of topSpots) {
    incrementSpotUseCount(spot.id);
  }
  await markSpotsVisited(phoneNumber, topSpots.map(s => s.id));
  trackEvent(phoneNumber, channel, "recommendation", {
    spot_ids: topSpots.map(s => s.id),
    spot_names: topSpots.map(s => s.name),
    categories,
    neighborhood: details.neighborhood,
  });

  // Build traveler preferences for context
  const prefs = traveler.preferences ?? {};
  const prefLines: string[] = [];
  if (traveler.dietary_restrictions?.length) prefLines.push(`Dietary restrictions: ${traveler.dietary_restrictions.join(", ")}`);
  if (prefs.budget) prefLines.push(`Budget: ${prefs.budget}`);
  if (prefs.interests?.length) prefLines.push(`Interests: ${prefs.interests.join(", ")}`);
  if (prefs.cuisine_preferences?.length) prefLines.push(`Cuisine preferences: ${prefs.cuisine_preferences.join(", ")}`);
  const prefContext = prefLines.length > 0 ? `\nUser preferences:\n${prefLines.join("\n")}` : "";

  // Format spots for Claude
  const spotContext = formatSpotsForLLM(spots.slice(0, 3));
  const weatherContext = weather ? `\nCurrent weather: ${weather.summary}` : "";

  const prompt = `The user asked: "${message}"
${travelerContext ? `\nAdditional context: ${travelerContext}` : ""}
${prefContext}
${weatherContext}

Here are the matching spots from your knowledge graph. Recommend them naturally — include operational details (payment, what to order, tips). Don't list them robotically; make it feel like a friend's recommendation.

${spotContext}`;

  return await chat(getSystemPrompt(), [{ role: "user", content: prompt }], {
    maxTokens: 512,
  });
}

export function formatOpeningHours(hours: Record<string, string>): string {
  return Object.entries(hours)
    .map(([day, time]) => `${day.charAt(0).toUpperCase() + day.slice(1)}: ${time}`)
    .join(", ");
}

export function confidenceLabel(score: number | undefined): string {
  const s = score ?? 0.7;
  if (s >= 0.85) return "personal favorite";
  if (s >= 0.6) return "well-vouched";
  return "fresh intel";
}

export function sourceLabel(source: string | undefined): string {
  switch (source) {
    case "voice": return "local contributor (voice note)";
    case "text": return "local contributor";
    case "seed":
    case "manual":
    default: return "curated by Sam";
  }
}

/** Try semantic search when structured query returns no results */
async function trySemanticSearch(
  message: string,
  city: string,
): Promise<Spot[]> {
  try {
    const { generateEmbedding } = await import("../embeddings.js");
    const embedding = await generateEmbedding(message);
    return await semanticSearchSpots(embedding, { city });
  } catch {
    // Semantic search unavailable (missing API key, no embeddings, etc.)
    return [];
  }
}

export function formatSpotsForLLM(spots: Spot[]): string {
  return spots
    .map((s, i) => {
      const lines = [`${i + 1}. ${s.name}`];
      if (s.neighborhood) lines.push(`   Neighborhood: ${s.neighborhood}`);
      if (s.category) lines.push(`   Category: ${s.category}`);
      if (s.address) lines.push(`   Address: ${s.address}`);
      if (s.price_range) lines.push(`   Price: ${s.price_range}`);
      if (s.payment_methods?.length)
        lines.push(`   Payment: ${s.payment_methods.join(", ")}`);
      if (s.opening_hours)
        lines.push(`   Hours: ${formatOpeningHours(s.opening_hours)}`);
      if (s.what_to_order?.length)
        lines.push(`   Order: ${s.what_to_order.join(", ")}`);
      if (s.what_to_skip?.length)
        lines.push(`   Skip: ${s.what_to_skip.join(", ")}`);
      if (s.pro_tips?.length)
        lines.push(`   Tips: ${s.pro_tips.join(" | ")}`);
      if (s.vibe) lines.push(`   Vibe: ${s.vibe}`);
      if (s.indoor_outdoor) lines.push(`   Setting: ${s.indoor_outdoor}`);
      if (s.best_time_of_day)
        lines.push(`   Best time: ${s.best_time_of_day}`);
      if (s.tier) lines.push(`   Tier: ${s.tier}`);
      lines.push(`   Sam's take: ${confidenceLabel(s.confidence_score)} (from ${sourceLabel(s.source)})`);
      return lines.join("\n");
    })
    .join("\n\n");
}
