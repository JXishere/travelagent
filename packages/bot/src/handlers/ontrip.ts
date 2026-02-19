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
import { resolveCategories, DEFAULT_CATEGORIES } from "../utils/categories.js";
import { getCityDefaults, getDefaultCity, resolveCityFromArea, resolveCitiesFromArea } from "../utils/city-defaults.js";
import { formatSpotsForLLM } from "./query.js";
import { parseCoordinates, filterByDistance, type SpotWithDistance } from "../utils/geo.js";

let _systemPrompt: string | null = null;
function getSystemPrompt(): string {
  if (!_systemPrompt) _systemPrompt = loadPrompt("system");
  return _systemPrompt;
}

interface IntentDetails {
  area?: string;
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
  details: IntentDetails,
  conversationHistory?: string
): Promise<PromptPayload> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();

  const cityDefaults = getCityDefaults(traveler.current_city);
  const hour = new Date().getUTCHours() + cityDefaults.utcOffset;
  const timeOfDay =
    details.time_of_day ??
    (hour < 11 ? "morning" : hour < 15 ? "afternoon" : hour < 20 ? "evening" : "late-night");

  const categories = resolveCategories(details.meal_type, timeOfDay);
  const isDishQuery = categories === null;

  // Resolve city from area — "PJ" maps to "Petaling Jaya", etc.
  const areaCities = resolveCitiesFromArea(details.area);
  const resolvedCity = resolveCityFromArea(details.area);
  // Use area-resolved cities if available, otherwise default city
  const queryCities = areaCities.length > 0 ? areaCities : undefined;
  const queryCity = queryCities ? undefined : cityDefaults.name;
  // Don't filter by area if it resolved to city names (e.g. "PJ" or "PJ or KL")
  const areaFilter = areaCities.length > 0 ? undefined : details.area;

  let spots: Spot[];
  let areaWidened = false;

  if (isDishQuery) {
    // Dish query ("roti", "laksa") — semantic search first, no category filter
    spots = await trySemanticSearch(message, resolvedCity ?? cityDefaults.name);
    if (spots.length === 0) {
      // Fallback: broad food categories
      spots = await querySpots({
        city: queryCity,
        cities: queryCities,
        area: areaFilter,
        categories: DEFAULT_CATEGORIES,
        indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
        limit: 5,
      });
      // If still empty and area was filtered, retry without area constraint
      if (spots.length === 0 && areaFilter) {
        areaWidened = true;
        spots = await querySpots({
          city: queryCity,
          cities: queryCities,
          categories: DEFAULT_CATEGORIES,
          indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
          limit: 5,
        });
      }
    }
  } else {
    // Category query ("dinner", "breakfast") — structured first, semantic fallback
    spots = await querySpots({
      city: queryCity,
      cities: queryCities,
      area: areaFilter,
      categories,
      indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
      limit: 5,
    });
    // If empty and area was filtered, retry without area constraint
    if (spots.length === 0 && areaFilter) {
      areaWidened = true;
      spots = await querySpots({
        city: queryCity,
        cities: queryCities,
        categories,
        indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
        limit: 5,
      });
    }
    if (spots.length === 0) {
      spots = await trySemanticSearch(message, resolvedCity ?? cityDefaults.name);
    }
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

You have NO spots in your knowledge graph yet for this query. Do NOT make up or suggest any restaurants, cafes, or places. Be honest that you don't have intel on this yet.${details.area ? ` Offer to search other areas of the city instead.` : ""} Keep it short — this is WhatsApp. Never tell them to "ask locals" — you ARE their local friend. Don't suggest specific neighborhoods or areas to try — you don't have verified data there either.`,
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

  // Detect area mismatch — user asked for a specific area but results are from elsewhere
  const requestedArea = details.area;
  const hasAreaMismatch =
    requestedArea &&
    toRecommend.length > 0 &&
    !toRecommend.some((s) =>
      s.area?.toLowerCase().includes(requestedArea.toLowerCase())
    );
  const areaNote =
    hasAreaMismatch || areaWidened
      ? `\n\nNote: The user asked for spots near "${requestedArea}" but you don't have picks in that exact area for this. These are the best options from the broader city. Be upfront about it — acknowledge the gap, then recommend these nearby alternatives naturally. Don't say "ask locals" — you ARE the local.`
      : "";

  return {
    systemPrompt: getSystemPrompt(),
    userPrompt: `The user says: "${message}"
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
Time: ${timeOfDay} (KL time)
${details.area ? `They're near: ${details.area}` : ""}
${weatherNote}
${tiredNote}
${prefContext}
${areaNote}

Here are spots from your knowledge graph:

${spotsContext}

Lead with your #1 pick and commit to it — be the friend who just says "go here." Mention 1-2 alternatives briefly. One must-order and one tip per spot, max. Respect their dietary restrictions. Don't end with a question unless the query is genuinely too vague to recommend anything.`,
    spotIds: toRecommend.map(s => s.id),
    maxTokens: 512,
  };
}

/** "I'm hungry" flow — location + time + preferences → recommend spots */
export async function handleHungry(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string
): Promise<string> {
  const payload = await buildHungryPrompt(phoneNumber, message, details, conversationHistory);
  return await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], {
    maxTokens: payload.maxTokens,
    model: payload.spotIds.length === 0 ? HAIKU : undefined,
  });
}

/** Build the day plan prompt without calling the LLM */
export async function buildDayPlanPrompt(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string
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
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
${weather ? `Weather: ${weather.summary}` : ""}
${details.mood ? `Their energy/mood: ${details.mood}` : ""}
${prefContext}
Spots they've already visited: ${traveler.spots_visited?.length ?? 0}

Available spots for building a day plan:

${spotsContext}

Build a loose, conversational day structure — "here's a nice flow for today." Include operational details for each spot. Respect their dietary restrictions. End with something casual like "text me when you're hungry or want to switch things up."`,
    spotIds: allDaySpots.map(s => s.id),
    maxTokens: 1024,
  };
}

/** "What should I do today?" flow — build a loose day structure */
export async function handleDayPlan(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string
): Promise<string> {
  const payload = await buildDayPlanPrompt(phoneNumber, message, details, conversationHistory);
  return await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], {
    maxTokens: payload.maxTokens,
  });
}

/** Build the nearby prompt without calling the LLM */
export async function buildNearbyPrompt(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string
): Promise<PromptPayload> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();
  const city = traveler.current_city ?? getDefaultCity();

  const area = details.area ?? details.specific_place;

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
    // Text-based area search
    spots = await querySpots({
      city,
      area,
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
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
${weather ? `Weather: ${weather.summary}` : ""}
${area ? `They're near: ${area}` : coords ? `They shared coordinates: ${coords.lat}, ${coords.lng}` : ""}
${distanceContext ? `\nDistances:\n${distanceContext}` : ""}
${prefContext}

Nearby spots from knowledge graph:

${spotsContext}

Give them a quick, varied list of what's nearby — mix food and activities. Respect their dietary restrictions.${distanceContext ? " Include the approximate distance for each spot." : " Include walking distance estimates if you can infer from area."} Keep it casual.`,
    spotIds: spots.map(s => s.id),
    maxTokens: 512,
  };
}

/** "I'm near X" flow — nearby recommendations */
export async function handleNearby(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string
): Promise<string> {
  const payload = await buildNearbyPrompt(phoneNumber, message, details, conversationHistory);
  return await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], {
    maxTokens: payload.maxTokens,
  });
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
    return [];
  }
}
