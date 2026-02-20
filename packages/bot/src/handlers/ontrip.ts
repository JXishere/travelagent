// On-trip guidance — real-time recommendations when the user is in KL

import { chat, loadPrompt, HAIKU, webSearchSpot } from "../llm.js";
import {
  querySpots,
  semanticSearchSpots,
  findSpotByName,
  getOrCreateTraveler,
  incrementSpotUseCount,
  markSpotsVisited,
  type Spot,
  type Traveler,
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
  cuisine?: string;
  time_of_day?: string;
  mood?: string;
  specific_place?: string;
}

// Categories where intent is clear but vibe/use-case is ambiguous
const VAGUE_MEAL_TYPES = new Set(["cafe", "coffee", "drinks", "dessert", "bar", "nightlife", "activity"]);

/** True when the query has no mood/vibe signal to differentiate use-case */
export function isVagueQuery(details: IntentDetails): boolean {
  const meal = (details.meal_type || "").toLowerCase();
  return VAGUE_MEAL_TYPES.has(meal) && !details.mood;
}

/**
 * True when the message is genuinely too vague to recommend anything —
 * no area, cuisine, meal type, or conversation history.
 * These should be intercepted before building a prompt and returned as
 * a direct clarifying question (same pattern as isVagueQuery).
 */
export function isUnclearQuery(details: IntentDetails, conversationHistory?: string): boolean {
  return !details.area && !details.cuisine && !details.meal_type && !conversationHistory;
}

/** Clarifying question for a bare hungry message with no context */
export const UNCLEAR_CLARIFYING_QUESTION = "What are you feeling? Any particular vibe or cuisine in mind?";

/** True when Sam has no meaningful profile data on this user */
export function isNewUser(traveler: Traveler): boolean {
  return traveler.user_type === "unknown"
    && !traveler.preferences?.budget
    && !(traveler.preferences?.interests?.length)
    && !traveler.dietary_restrictions?.length;
}

/** Targeted clarifying question by category — never generic "what are you in the mood for?" */
export function getClarifyingQuestion(details: IntentDetails): string {
  const meal = (details.meal_type || "").toLowerCase();
  const area = details.area ? ` around ${details.area}` : "";
  if (["cafe", "coffee"].includes(meal)) return `Working session or catching up with someone${area}?`;
  if (["drinks", "bar", "nightlife"].includes(meal)) return "Low-key vibe or looking to go out properly?";
  if (meal === "dessert") return "Sit-down somewhere or grab and go?";
  if (meal === "activity") return "Solo or with people?";
  return "Any particular vibe in mind?";
}

/** Return value from prompt builders — everything needed to call the LLM */
export interface PromptPayload {
  systemPrompt: string;
  userPrompt: string;
  spotIds: string[];
  maxTokens?: number;
}

/** Build a preference context string for LLM prompts */
export function buildPrefContext(traveler: { dietary_restrictions?: string[]; preferences?: Record<string, any>; user_type?: string; home_areas?: string[] }): string {
  const lines: string[] = [];
  if (traveler.user_type && traveler.user_type !== "unknown")
    lines.push(`User type: ${traveler.user_type}${traveler.home_areas?.length ? ` (from ${traveler.home_areas.join(", ")})` : ""}`);
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

  // cuisine is a specific dish (e.g. "nasi lemak", "laksa") — treat as dish query so
  // semantic search is used instead of a time-of-day category fallback.
  const categories = resolveCategories(details.meal_type ?? details.cuisine, timeOfDay);
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
    // Use the specific dish/cuisine from details as the search query, not the raw message
    // (raw message might be "other choices?" which has no semantic signal for the dish)
    const searchQuery = details.cuisine ?? message;
    spots = await trySemanticSearch(searchQuery, resolvedCity ?? cityDefaults.name);
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
    toRecommend = unvisited.length > 0 ? unvisited.slice(0, 3) : spots.slice(0, 3);
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
  const alreadyAskedLocalOrVisiting = !!conversationHistory?.includes("local or just visiting");
  const newUserNote = !alreadyAskedLocalOrVisiting && isNewUser(traveler)
    ? `\nThis user is new — Sam doesn't know them yet. After giving the recommendation, add one casual line: "Quick one — local or just visiting? Helps me tune what I show you." Only add this if you haven't already asked.`
    : "";

  // Detect area mismatch — user asked for a specific area but results are from elsewhere.
  // Skip mismatch check if the area resolved to a city-level alias (e.g. "PJ" → "Petaling Jaya"),
  // because spots in that city won't have "PJ" in their area field.
  const requestedArea = details.area;
  const isCityAlias = areaCities.length > 0;
  const hasAreaMismatch =
    !isCityAlias &&
    requestedArea &&
    toRecommend.length > 0 &&
    !toRecommend.some((s) =>
      s.area?.toLowerCase().includes(requestedArea.toLowerCase())
    );
  const areaNote =
    hasAreaMismatch || areaWidened
      ? `\n\nIMPORTANT: The user asked for spots in "${requestedArea}" but you have no specific picks for that area yet. Your FIRST sentence must acknowledge you don't have ${requestedArea} coverage. Then offer these as nearby alternatives — do NOT present them as ${requestedArea} recommendations. Be honest about the gap.`
      : "";

  const cuisineNote = details.cuisine
    ? `They want: ${details.cuisine} — look for spots where this appears in what_to_order or fits the vibe.`
    : "";

  const noRepeatNote = conversationHistory
    ? `\nIf a spot was already recommended in the conversation above, do NOT recommend it again. If you genuinely have no new options, say so — "Village Park is honestly the best I've got for nasi lemak in PJ" is a fine answer.`
    : "";

  return {
    systemPrompt: getSystemPrompt(),
    userPrompt: `The user says: "${message}"
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
Time: ${timeOfDay} (KL time)
${details.area ? `They're near: ${details.area}` : ""}
${weatherNote}
${tiredNote}
${cuisineNote}
${prefContext}
${areaNote}
${newUserNote}

Here are spots from your knowledge graph:

${spotsContext}

RESPONSE FORMAT — follow exactly:
- Start your response with the spot name. No intro sentence. No "If you want..." opener.
- Line 1: Name (Area)
- Line 2: what to order + one tip
- Blank line between spots
- Max 3 spots
- Lead with your #1 pick

Example of correct format:
Dewakan (KLCC)
Tasting menu only — book 2 weeks ahead.

Bar.Kar (KLCC)
Open-flame dishes, reserve in advance.

Respect dietary restrictions. Don't end with a question unless the query is genuinely too vague to recommend anything.${noRepeatNote}`,
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

If the user is specifically asking about non-food activities (things to do, sightseeing, etc.), be honest that your strength is food and dining. You can mention any activity spots you have, but flag that you don't have full activities coverage and they should check elsewhere for that.

Build a loose, conversational day structure — "here's a nice flow for today." Include operational details for each spot. Only mention spots from the data above — never invent activities, attractions, or places not in your knowledge. Respect their dietary restrictions. End with something casual like "text me when you're hungry or want to switch things up."`,
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

/**
 * Spot info handler — answers specific questions about a named place.
 * DB record + web search run in parallel; DB wins where data exists,
 * web fills the blanks. Always has something to say.
 */
export async function handleSpotInfo(
  phoneNumber: string,
  userMessage: string,
  spotName: string,
  city: string
): Promise<string> {
  const systemPrompt = getSystemPrompt().replaceAll("{{CITY}}", city);

  // Fetch DB record and web data in parallel
  const [dbSpot, webData] = await Promise.all([
    findSpotByName(spotName, city),
    webSearchSpot(spotName, city),
  ]);

  // No DB record — don't answer from web data alone (hallucination risk).
  // Web search may find real info but we can't verify it matches Sam's knowledge graph.
  if (!dbSpot) {
    return chat(
      systemPrompt,
      [{ role: "user", content: `User asked: "${userMessage}". You have no record of "${spotName}" in your knowledge graph. Respond in one sentence — be honest that you don't have intel on it yet.` }],
      { maxTokens: 100 }
    );
  }

  // Merge: DB fields win, web fills gaps for fields the DB is missing
  const merged: Record<string, any> = { ...webData };
  for (const [k, v] of Object.entries(dbSpot)) {
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
      merged[k] = v;
    }
  }

  // Volatile fields: always use live web data, never stale DB values
  for (const field of ["opening_hours", "payment_methods"] as const) {
    if ((webData as any)[field]) {
      merged[field] = (webData as any)[field];
    } else {
      delete merged[field];
    }
  }

  // Flag hours as web-sourced if the DB record doesn't have them
  const hoursFromWeb = !dbSpot.opening_hours && !!merged.opening_hours;

  const dataBlock = [
    merged.name && `Name: ${merged.name}`,
    merged.area && `Area: ${merged.area}`,
    merged.address && `Address: ${merged.address}`,
    merged.category && `Category: ${merged.category}`,
    merged.price_range && `Price: ${merged.price_range}`,
    merged.payment_methods?.length && `Payment: ${(merged.payment_methods as string[]).join(", ")}`,
    merged.opening_hours && `Hours: ${JSON.stringify(merged.opening_hours)}${hoursFromWeb ? " (from web — may be outdated)" : ""}`,
    merged.what_to_order?.length && `Order: ${(merged.what_to_order as string[]).join(", ")}`,
    merged.what_to_skip?.length && `Skip: ${(merged.what_to_skip as string[]).join(", ")}`,
    merged.pro_tips?.length && `Tips: ${(merged.pro_tips as string[]).join(" | ")}`,
    merged.vibe && `Vibe: ${merged.vibe}`,
    merged.indoor_outdoor && `Setting: ${merged.indoor_outdoor}`,
    merged.best_time_of_day && `Best time: ${merged.best_time_of_day}`,
  ].filter(Boolean).join("\n");

  return chat(
    systemPrompt,
    [{
      role: "user",
      content: `Spot data:\n${dataBlock}\n\nUser question: ${userMessage}\n\nAnswer the user's question using the spot data above. Be specific and direct. 2-3 sentences max.${hoursFromWeb ? " Hours are from the web — tell them to confirm before visiting." : ""}`,
    }],
    { maxTokens: 200 }
  );
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
