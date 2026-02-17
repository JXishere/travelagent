// On-trip guidance — real-time recommendations when the user is in KL

import { chat, loadPrompt, HAIKU } from "../llm.js";
import {
  querySpots,
  semanticSearchSpots,
  getOrCreateTraveler,
  incrementSpotUseCount,
  markSpotsVisited,
  type Spot,
} from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { resolveCategories } from "../utils/categories.js";
import { getCityDefaults, getDefaultCity } from "../utils/city-defaults.js";
import { formatSpotsForLLM } from "./query.js";
import { parseCoordinates, filterByDistance, type SpotWithDistance } from "../utils/geo.js";

let _systemPrompt: string | null = null;
function getSystemPrompt(): string {
  if (!_systemPrompt) _systemPrompt = loadPrompt("system");
  return _systemPrompt;
}

interface IntentDetails {
  neighborhood?: string;
  meal_type?: string;
  time_of_day?: string;
  mood?: string;
  specific_place?: string;
}

/** Return value from prompt builders — everything needed to call the LLM */
export interface PromptPayload {
  systemPrompt: string;
  userPrompt: string;
  spotIds: string[];
  maxTokens?: number;
}

/** Build a preference context string for LLM prompts */
export function buildPrefContext(traveler: { dietary_restrictions?: string[]; preferences?: Record<string, any> }): string {
  const lines: string[] = [];
  if (traveler.dietary_restrictions?.length)
    lines.push(`Dietary restrictions: ${traveler.dietary_restrictions.join(", ")}`);
  const prefs = traveler.preferences ?? {};
  if (prefs.budget) lines.push(`Budget: ${prefs.budget}`);
  if (prefs.interests?.length)
    lines.push(`Interests: ${prefs.interests.join(", ")}`);
  if (prefs.cuisine_preferences?.length)
    lines.push(`Cuisine preferences: ${prefs.cuisine_preferences.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "";
}

/** Build the hungry prompt without calling the LLM */
export async function buildHungryPrompt(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<PromptPayload> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();

  const cityDefaults = getCityDefaults(traveler.current_city);
  const hour = new Date().getUTCHours() + cityDefaults.utcOffset;
  const timeOfDay =
    details.time_of_day ??
    (hour < 11 ? "morning" : hour < 15 ? "afternoon" : hour < 20 ? "evening" : "late-night");

  const categories = resolveCategories(details.meal_type, timeOfDay);

  let spots = await querySpots({
    city: cityDefaults.name,
    neighborhood: details.neighborhood,
    categories,
    indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
    limit: 5,
  });

  // If structured query found nothing and user has a mood/vibe, try semantic search
  if (spots.length === 0) {
    spots = await trySemanticSearch(message, cityDefaults.name, categories);
  }

  // Filter out visited spots only for travelers (locals may want to revisit favorites)
  let toRecommend: Spot[];
  if (traveler.user_type !== "local") {
    const unvisited = spots.filter(
      (s) => !traveler.spots_visited?.includes(s.id)
    );
    toRecommend = unvisited.length >= 3 ? unvisited.slice(0, 3) : spots.slice(0, 3);
  } else {
    // For locals, filter out disliked spots instead
    const notDisliked = spots.filter(
      (s) => !traveler.spots_disliked?.includes(s.id)
    );
    toRecommend = notDisliked.slice(0, 3);
  }

  for (const spot of toRecommend) {
    incrementSpotUseCount(spot.id);
  }
  await markSpotsVisited(phoneNumber, toRecommend.map(s => s.id));

  // No spots in DB — be honest
  if (toRecommend.length === 0) {
    return {
      systemPrompt: getSystemPrompt(),
      userPrompt: `The user says: "${message}"

You have NO spots in your knowledge graph yet for this query. Do NOT make up or suggest any restaurants, cafes, or places. Be honest that you don't have recommendations yet. Ask what they're in the mood for so you can help when your knowledge grows, or suggest they contribute spots they discover.

Keep it short — this is WhatsApp.`,
      spotIds: [],
      maxTokens: 512,
    };
  }

  const spotsContext = formatSpotsForLLM(toRecommend);
  const weatherNote = weather?.is_raining
    ? "It's raining right now — prioritize indoor/covered spots."
    : "";

  const tiredNote =
    details.mood === "tired" || details.mood === "chill"
      ? "They're feeling tired — recommend nearby and chill options."
      : "";

  const prefContext = buildPrefContext(traveler);

  return {
    systemPrompt: getSystemPrompt(),
    userPrompt: `The user says: "${message}"

Time: ${timeOfDay} (KL time)
${details.neighborhood ? `They're near: ${details.neighborhood}` : "Location not specified — you can ask."}
${weatherNote}
${tiredNote}
${prefContext}

Here are spots from your knowledge graph:

${spotsContext}

Recommend naturally. Include full operational details. Respect their dietary restrictions — do NOT recommend dishes or spots that conflict. End by asking which one appeals or if they want something different. Keep it concise — this is WhatsApp, not email.`,
    spotIds: toRecommend.map(s => s.id),
    maxTokens: 1024,
  };
}

/** "I'm hungry" flow — location + time + preferences → recommend spots */
export async function handleHungry(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<string> {
  const payload = await buildHungryPrompt(phoneNumber, message, details);
  return await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], {
    maxTokens: payload.maxTokens,
    model: payload.spotIds.length === 0 ? HAIKU : undefined,
  });
}

/** Build the day plan prompt without calling the LLM */
export async function buildDayPlanPrompt(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<PromptPayload> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();
  const city = traveler.current_city ?? getDefaultCity();

  // Get a mix of spots for the day
  const breakfastSpots = await querySpots({ city, categories: ["breakfast", "cafe"], limit: 3 });
  const lunchSpots = await querySpots({ city, categories: ["lunch"], limit: 3 });
  const activitySpots = await querySpots({ city, categories: ["activity", "market"], limit: 3 });
  const dinnerSpots = await querySpots({ city, categories: ["dinner"], limit: 3 });

  const allDaySpots = [...breakfastSpots, ...lunchSpots, ...activitySpots, ...dinnerSpots];
  const spotsContext = formatSpotsForLLM(allDaySpots);

  // Mark all recommended spots as visited
  await markSpotsVisited(phoneNumber, allDaySpots.map(s => s.id));

  const prefContext = buildPrefContext(traveler);

  return {
    systemPrompt: getSystemPrompt(),
    userPrompt: `The user asks: "${message}"

${weather ? `Weather: ${weather.summary}` : ""}
${details.mood ? `Their energy/mood: ${details.mood}` : ""}
${prefContext}
Spots they've already visited: ${traveler.spots_visited?.length ?? 0}

Available spots for building a day plan:

${spotsContext}

Build a loose, conversational day structure. NOT a rigid itinerary — more like "here's a nice flow for today." Ask about their energy level if they didn't mention it. Include operational details for each spot. Respect their dietary restrictions — skip dishes that conflict. End with "text me when you're hungry or want to adjust!"`,
    spotIds: allDaySpots.map(s => s.id),
    maxTokens: 1500,
  };
}

/** "What should I do today?" flow — build a loose day structure */
export async function handleDayPlan(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<string> {
  const payload = await buildDayPlanPrompt(phoneNumber, message, details);
  return await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], {
    maxTokens: payload.maxTokens,
  });
}

/** Build the nearby prompt without calling the LLM */
export async function buildNearbyPrompt(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<PromptPayload> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();
  const city = traveler.current_city ?? getDefaultCity();

  const neighborhood = details.neighborhood ?? details.specific_place;

  // Check if the user provided coordinates (e.g. "3.139,101.687")
  const coords = parseCoordinates(details.specific_place ?? message);
  let spots: Spot[];
  let distanceContext = "";

  if (coords) {
    // Coordinate-based: fetch all city spots and filter by distance
    const allSpots = await querySpots({
      city,
      indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
      limit: 50,
    });
    const nearby = filterByDistance(allSpots, coords.lat, coords.lng, 3);
    spots = nearby.slice(0, 5);

    // Build distance annotations for the LLM
    if (nearby.length > 0) {
      distanceContext = nearby
        .slice(0, 5)
        .map((s: SpotWithDistance) => `${s.name}: ~${s.distance_km.toFixed(1)} km away`)
        .join("\n");
    }
  } else {
    // Text-based neighborhood search
    spots = await querySpots({
      city,
      neighborhood,
      indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
      limit: 5,
    });
  }

  const spotsContext = formatSpotsForLLM(spots);

  // Track usage and mark as visited
  for (const spot of spots) {
    incrementSpotUseCount(spot.id);
  }
  await markSpotsVisited(phoneNumber, spots.map(s => s.id));

  const prefContext = buildPrefContext(traveler);

  return {
    systemPrompt: getSystemPrompt(),
    userPrompt: `The user says: "${message}"

${weather ? `Weather: ${weather.summary}` : ""}
${neighborhood ? `They're near: ${neighborhood}` : coords ? `They shared coordinates: ${coords.lat}, ${coords.lng}` : "Location unclear — ask them."}
${distanceContext ? `\nDistances:\n${distanceContext}` : ""}
${prefContext}

Nearby spots from knowledge graph:

${spotsContext}

Give them a quick, varied list of what's nearby — mix food and activities. Respect their dietary restrictions.${distanceContext ? " Include the approximate distance for each spot." : " Include walking distance estimates if you can infer from neighborhood."} Keep it casual.`,
    spotIds: spots.map(s => s.id),
    maxTokens: 1024,
  };
}

/** "I'm near X" flow — nearby recommendations */
export async function handleNearby(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<string> {
  const payload = await buildNearbyPrompt(phoneNumber, message, details);
  return await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], {
    maxTokens: payload.maxTokens,
  });
}

/** Try semantic search when structured query returns no results */
async function trySemanticSearch(
  message: string,
  city: string,
  categories?: string[]
): Promise<Spot[]> {
  try {
    const { generateEmbedding } = await import("../embeddings.js");
    const embedding = await generateEmbedding(message);
    return await semanticSearchSpots(embedding, { city, categories });
  } catch {
    return [];
  }
}
