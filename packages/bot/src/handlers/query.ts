// Query flow — "I'm hungry near Bangsar" → spot recommendations from knowledge graph

import { chat, loadPrompt, HAIKU } from "../llm.js";
import { querySpots, incrementSpotUseCount, markSpotsVisited, getOrCreateTraveler, type Spot } from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { resolveCategories } from "../utils/categories.js";
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
  travelerContext?: string
): Promise<string> {
  const categories = resolveCategories(details.meal_type, details.time_of_day);
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();

  // Build query filters
  const spots = await querySpots({
    city: traveler.current_city ?? getDefaultCity(),
    neighborhood: details.neighborhood,
    categories,
    indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
    limit: 5,
  });

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
  for (const spot of spots.slice(0, 3)) {
    incrementSpotUseCount(spot.id);
  }
  await markSpotsVisited(phoneNumber, spots.slice(0, 3).map(s => s.id));

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
    maxTokens: 1024,
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
      lines.push(`   Sam's take: ${confidenceLabel(s.confidence_score)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
