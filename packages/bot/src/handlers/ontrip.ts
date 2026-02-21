// On-trip guidance — real-time recommendations when the user is in KL

import { chat, buildSystemPrompt, HAIKU, webSearchSpot, langInstruction, langUserNote } from "../llm.js";
import {
  querySpots,
  semanticSearchSpots,
  findSpotByName,
  getOrCreateTraveler,
  incrementSpotUseCount,
  markSpotsVisited,
  getAreaCentroid,
  getDistinctAreas,
  type Spot,
  type Traveler,
} from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { resolveCategories, DEFAULT_CATEGORIES } from "../utils/categories.js";
import { getCityDefaults, getDefaultCity, isSupportedCity, getSupportedCities, resolveCityFromArea, resolveCitiesFromArea, CITY_LEVEL_ALIASES, AREA_CITY_MAP_KEYS } from "../utils/city-defaults.js";
import { formatSpotsForLLM } from "./query.js";
import { parseCoordinates, filterByDistance, haversineKm, type SpotWithDistance } from "../utils/geo.js";
import { parseAreas } from "../utils/area-extractor.js";

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
export function isUnclearQuery(details: IntentDetails, conversationHistory?: string, message?: string): boolean {
  if (details.area || details.cuisine || details.meal_type || conversationHistory) return false;
  // A message with more than 5 words has enough implicit context — don't deflect with a clarifying question
  const wordCount = (message ?? "").trim().split(/\s+/).filter(Boolean).length;
  return wordCount <= 5;
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
  conversationHistory?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<PromptPayload> {
  const channel = options?.channel;
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();

  // Detect unsupported city — return honest "no coverage" before querying with wrong defaults
  if (traveler.current_city && !isSupportedCity(traveler.current_city)) {
    const supported = getSupportedCities().join(", ");
    return {
      systemPrompt: buildSystemPrompt(getDefaultCity(), channel),
      userPrompt: `The user says: "${message}" — they're asking about ${traveler.current_city}. Be honest and warm: you don't have coverage there yet, but you're great for ${supported}. One to two sentences, no spot recommendations.`,
      spotIds: [],
      maxTokens: 256,
    };
  }

  const cityDefaults = getCityDefaults(traveler.current_city);
  const hour = new Date().getUTCHours() + cityDefaults.utcOffset;
  const timeOfDay =
    details.time_of_day ??
    (hour < 11 ? "morning" : hour < 15 ? "afternoon" : hour < 20 ? "evening" : "late-night");

  // Infer meal type from time of day when the user gave no specific signal
  if (!details.meal_type && !details.cuisine) {
    if (hour >= 6 && hour < 11)       details.meal_type = "breakfast";
    else if (hour >= 11 && hour < 15) details.meal_type = "lunch";
    else if (hour >= 15 && hour < 18) details.meal_type = "cafe";
    else                               details.meal_type = "dinner";
  }

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

  const dislikedIds = traveler.spots_disliked ?? [];

  if (isDishQuery) {
    // Dish query ("roti", "laksa") — semantic search first, no category filter
    // Use the specific dish/cuisine from details as the search query, not the raw message
    // (raw message might be "other choices?" which has no semantic signal for the dish)
    const searchQuery = details.cuisine ?? message;
    spots = (await trySemanticSearch(searchQuery, resolvedCity ?? cityDefaults.name))
      .filter(s => !dislikedIds.includes(s.id));
    if (spots.length === 0) {
      // Fallback: broad food categories
      spots = await querySpots({
        city: queryCity,
        cities: queryCities,
        area: areaFilter,
        categories: DEFAULT_CATEGORIES,
        indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
        excludeIds: dislikedIds,
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
          excludeIds: dislikedIds,
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
      excludeIds: dislikedIds,
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
        excludeIds: dislikedIds,
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
      systemPrompt: buildSystemPrompt(cityDefaults.name, channel) + langInstruction(message),
      userPrompt: `The user says: "${message}"

You have NO spots in your knowledge graph yet for this query. Do NOT make up or suggest any restaurants, cafes, or places. Be honest that you don't have intel on this yet.${details.area ? ` Offer to search other areas of the city instead.` : ""} Keep it short — this is WhatsApp. Never tell them to "ask locals" — you're the one they're asking. Don't suggest specific neighborhoods or areas to try — you don't have verified data there either.`,
      spotIds: [],
      maxTokens: 512,
    };
  }

  // Build distance labels for spots not in the requested sub-area.
  // Mirrors the same logic in handleQuery so distance annotations appear consistently.
  // We use details.area here (not areaFilter) because areaFilter is cleared when the
  // area resolves to a city alias (e.g. "SS2" → Petaling Jaya), but we still want
  // the centroid from the user's actual requested area for distance annotations.
  const distanceFromArea = new Map<string, string>();
  if (details.area) {
    const dbAreas = await getDistinctAreas();
    const rawAreas = parseAreas(details.area, dbAreas, AREA_CITY_MAP_KEYS);
    const subAreas = rawAreas.filter(a => !CITY_LEVEL_ALIASES.has(a.toLowerCase()));
    const primaryArea = subAreas[0];
    if (primaryArea) {
      const areaCentroid = await getAreaCentroid(primaryArea);
      if (areaCentroid) {
        for (const spot of toRecommend) {
          const inRequestedArea = subAreas.some(a =>
            spot.area?.toLowerCase().includes(a.toLowerCase())
          );
          if (!inRequestedArea && spot.latitude != null && spot.longitude != null) {
            const km = haversineKm(areaCentroid.lat, areaCentroid.lng, spot.latitude, spot.longitude);
            const label = km < 1
              ? `~${Math.round(km * 1000)}m from ${primaryArea}`
              : `~${km.toFixed(1)}km from ${primaryArea}`;
            distanceFromArea.set(spot.id, label);
          }
        }
      }
    }
  }

  const spotsContext = formatSpotsForLLM(toRecommend, distanceFromArea);
  const weatherNote = weather?.is_raining
    ? "It's raining right now — prioritize indoor/covered spots."
    : "";

  const tiredNote =
    details.mood === "tired" || details.mood === "chill"
      ? "They're feeling tired — recommend nearby and chill options."
      : "";

  const prefContext = buildPrefContext(traveler);
  const alreadyAskedLocalOrVisiting = !!conversationHistory?.includes("local or just visiting");
  const newUserNote = alreadyAskedLocalOrVisiting
    ? `\nDo NOT ask "local or just visiting?" — you have already asked this.`
    : !alreadyAskedLocalOrVisiting && isNewUser(traveler)
      ? `\nThis user is new — Sam doesn't know them yet. After giving the recommendation, add one casual line: "Quick one — local or just visiting? Helps me tune what I show you." Only add this if you haven't already asked.`
      : "";

  // Detect area mismatch — user asked for a specific area but results are from elsewhere.
  // For city-level aliases (e.g. "SS2" → Petaling Jaya), check against the original sub-area
  // string (e.g. "ss2") rather than skipping — spots in PJ won't have "PJ" in area but they
  // may or may not have "SS2". We still want to detect when results aren't from the requested spot.
  const requestedArea = details.area;
  const hasAreaMismatch =
    requestedArea &&
    toRecommend.length > 0 &&
    !toRecommend.some((s) =>
      s.area?.toLowerCase().includes(requestedArea.toLowerCase())
    );
  const hasDistanceLabels = distanceFromArea.size > 0;
  const areaNote =
    hasAreaMismatch || areaWidened
      ? `\n\nIMPORTANT: The user asked for spots in "${requestedArea}" but these picks are from nearby areas. Mention the actual area for each spot so they can judge the distance.${hasDistanceLabels ? " Use the Distance field if present — say \"~Xkm away\" not \"a short drive\". NEVER invent distances." : " Be honest about the gap."}`
      : "";

  const cuisineNote = details.cuisine
    ? `They want: ${details.cuisine} — look for spots where this appears in what_to_order or fits the vibe.`
    : "";

  const noRepeatNote = conversationHistory
    ? `\nIf a spot was already recommended in the conversation above, do NOT recommend it again. If you genuinely have no new options, say so — "Village Park is honestly the best I've got for nasi lemak in PJ" is a fine answer.`
    : "";

  return {
    systemPrompt: buildSystemPrompt(cityDefaults.name, channel) + langInstruction(message),
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

STRICT DATA RULE — overrides everything:
- ONLY mention details explicitly listed in the spot data above (Order, Tips, Hours, Price, Payment, Vibe, Setting, Distance).
- If Order or Tips are absent for a spot, do NOT invent them. Use: "I know this spot but don't have deep intel yet."
- NEVER mention distance or travel time unless a Distance field is present in the spot data. If no Distance field, do not say how far anything is.
- NEVER add sell-out times, operating hours, or payment methods unless they appear in the data above.

RESPONSE FORMAT — follow exactly:
- Start your response with the spot name. No intro sentence. No "If you want..." opener.
- Line 1: Name (Area)
- Line 2: what to order + one tip (only if data exists)
- Blank line between spots
- Max 3 spots
- Lead with your #1 pick

Example of correct format:
Dewakan (KLCC)
Tasting menu only — book 2 weeks ahead.

Bar.Kar (KLCC)
Open-flame dishes, reserve in advance.

Respect dietary restrictions. Don't end with a question unless the query is genuinely too vague to recommend anything.${noRepeatNote}${langUserNote(message)}`,
    spotIds: toRecommend.map(s => s.id),
    maxTokens: 512,
  };
}

/** "I'm hungry" flow — location + time + preferences → recommend spots */
export async function handleHungry(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const payload = await buildHungryPrompt(phoneNumber, message, details, conversationHistory, options);
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
  conversationHistory?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<PromptPayload> {
  const channel = options?.channel;
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();
  const defaultCity = traveler.current_city ?? getDefaultCity();

  // Detect unsupported city
  if (traveler.current_city && !isSupportedCity(traveler.current_city)) {
    const supported = getSupportedCities().join(", ");
    return {
      systemPrompt: buildSystemPrompt(getDefaultCity(), channel),
      userPrompt: `The user wants a day plan but they're in ${traveler.current_city}. Be honest and warm: you don't have coverage there yet, but you're great for ${supported}. One to two sentences.`,
      spotIds: [],
      maxTokens: 256,
    };
  }

  // Resolve city from area if user specified one (e.g. "what to do in PJ" → city = "Petaling Jaya")
  const areaCities = resolveCitiesFromArea(details.area);
  const queryCities = areaCities.length > 0 ? areaCities : undefined;
  const city = queryCities ? undefined : defaultCity;
  const cities = queryCities;

  const dislikedIds = traveler.spots_disliked ?? [];

  // Get a mix of spots for the day
  const breakfastSpots = await querySpots({ city, cities, categories: ["breakfast", "cafe"], excludeIds: dislikedIds, limit: 3 });
  const lunchSpots = await querySpots({ city, cities, categories: ["lunch"], excludeIds: dislikedIds, limit: 3 });
  const activitySpots = await querySpots({ city, cities, categories: ["activity", "market"], excludeIds: dislikedIds, limit: 3 });
  const dinnerSpots = await querySpots({ city, cities, categories: ["dinner"], excludeIds: dislikedIds, limit: 3 });

  const allDaySpots = [...breakfastSpots, ...lunchSpots, ...activitySpots, ...dinnerSpots];
  const spotsContext = formatSpotsForLLM(allDaySpots);

  // Mark all recommended spots as visited
  await markSpotsVisited(phoneNumber, allDaySpots.map(s => s.id));

  const prefContext = buildPrefContext(traveler);

  // Use the resolved city name (first from cities, or defaultCity) for the system prompt
  const systemCity = (cities?.[0]) ?? defaultCity;

  return {
    systemPrompt: buildSystemPrompt(systemCity, channel) + langInstruction(message),
    userPrompt: `The user asks: "${message}"
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
${weather ? `Weather: ${weather.summary}` : ""}
${details.area ? `Area focus: ${details.area}` : ""}
${details.mood ? `Their energy/mood: ${details.mood}` : ""}
${prefContext}
Spots they've already visited: ${traveler.spots_visited?.length ?? 0}

Available spots for building a day plan:

${spotsContext}

If the user is specifically asking about non-food activities (things to do, sightseeing, etc.), be honest that your strength is food and dining. You can mention any activity spots you have, but flag that you don't have full activities coverage and they should check elsewhere for that.

STRICT DATA RULE: Only mention details explicitly listed for each spot in the data above (Order, Tips, Hours, Price, Vibe). If a spot has no Order or Tips data, say "I know this place but don't have deep intel" — never invent dishes, hours, prices, or travel times. Never estimate how long it takes to get from one spot to another.

Build a loose, conversational day structure — "here's a nice flow for today." Only mention spots from the data above — never invent activities, attractions, or places not in your knowledge. Respect their dietary restrictions. For an "eat all day" or food-focused request, cover breakfast/morning, lunch, afternoon, and dinner — aim for 4-5 stops across the day. End with something casual like "text me when you're hungry or want to switch things up."${langUserNote(message)}`,
    spotIds: allDaySpots.map(s => s.id),
    maxTokens: 1024,
  };
}

/** "What should I do today?" flow — build a loose day structure */
export async function handleDayPlan(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const payload = await buildDayPlanPrompt(phoneNumber, message, details, conversationHistory, options);
  return await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], {
    maxTokens: payload.maxTokens,
  });
}

/** Build the nearby prompt without calling the LLM */
export async function buildNearbyPrompt(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<PromptPayload> {
  const channel = options?.channel;
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();
  const city = traveler.current_city ?? getDefaultCity();

  // Detect unsupported city
  if (traveler.current_city && !isSupportedCity(traveler.current_city)) {
    const supported = getSupportedCities().join(", ");
    return {
      systemPrompt: buildSystemPrompt(getDefaultCity(), channel),
      userPrompt: `The user is asking what's nearby but they're in ${traveler.current_city}. Be honest and warm: you don't have coverage there yet, but you're great for ${supported}. One to two sentences.`,
      spotIds: [],
      maxTokens: 256,
    };
  }

  const area = details.area ?? details.specific_place;
  const dislikedIds = traveler.spots_disliked ?? [];

  // Check if the user provided coordinates (e.g. "3.139,101.687")
  const coords = parseCoordinates(details.specific_place ?? message);
  let spots: Spot[];
  let distanceContext = "";

  if (coords) {
    // Coordinate-based: fetch all city spots and filter by distance
    const allSpots = await querySpots({
      city,
      indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
      excludeIds: dislikedIds,
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
      excludeIds: dislikedIds,
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
    systemPrompt: buildSystemPrompt(city, channel) + langInstruction(message),
    userPrompt: `The user says: "${message}"
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
${weather ? `Weather: ${weather.summary}` : ""}
${area ? `They're near: ${area}` : coords ? `They shared coordinates: ${coords.lat}, ${coords.lng}` : ""}
${distanceContext ? `\nDistances:\n${distanceContext}` : ""}
${prefContext}

Nearby spots from knowledge graph:

${spotsContext}

Give them a quick, varied list of what's nearby — mix food and activities. Respect their dietary restrictions.${distanceContext ? " Include the approximate distance for each spot (use the Distances list above)." : " Do NOT estimate walking times or distances — you don't have GPS data."} Keep it casual.${langUserNote(message)}`,
    spotIds: spots.map(s => s.id),
    maxTokens: 512,
  };
}

/** "I'm near X" flow — nearby recommendations */
export async function handleNearby(
  phoneNumber: string,
  message: string,
  details: IntentDetails,
  conversationHistory?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const payload = await buildNearbyPrompt(phoneNumber, message, details, conversationHistory, options);
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
  city: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const systemPrompt = buildSystemPrompt(city, options?.channel);

  // Step 1: fetch DB record first
  const dbSpot = await findSpotByName(spotName, city);

  // No DB record — don't answer from web data alone (hallucination risk).
  // Web search may find real info but we can't verify it matches Sam's knowledge graph.
  if (!dbSpot) {
    return chat(
      systemPrompt,
      [{ role: "user", content: `User asked: "${userMessage}". You have no record of "${spotName}" in your knowledge graph. Be honest that you don't have intel on it yet, then offer to show what you do know in ${city} — ask if there's a specific area or type of food they want. Two sentences max.` }],
      { maxTokens: 150 }
    );
  }

  // Step 2: decide if web search adds value
  // Only search for live volatile fields (hours, payment) or sparse spots missing core data
  const VOLATILE_KEYWORDS = /\b(open|close|shut|hours|today|now|payment|cash|card|credit|debit|pay|accept)\b/i;
  const spotIsSparse = !dbSpot.what_to_order?.length && !dbSpot.address;
  const needsWebSearch = VOLATILE_KEYWORDS.test(userMessage) || spotIsSparse;

  // Step 3: conditionally fetch web data
  const webData = needsWebSearch ? await webSearchSpot(spotName, city) : {};

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
    merged.categories?.length && `Category: ${merged.categories.join(", ")}`,
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
