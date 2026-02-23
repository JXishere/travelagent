// On-trip guidance — real-time recommendations when the user is in KL

import { chat, buildSystemPrompt, HAIKU, webSearchSpot, langInstruction, langUserNote } from "../llm.js";
import {
  querySpots,
  semanticSearchSpots,
  findSpotByName,
  getOrCreateTraveler,
  incrementRecommendationCount,
  markSpotsRecommended,
  trackEvent,
  getAreaCentroid,
  getDistinctAreas,
  queryHappenings,
  type Spot,
  type Traveler,
  type Happening,
} from "../database.js";
import { getCurrentWeather, getDayForecast } from "../weather.js";
import { resolveCategories, DEFAULT_CATEGORIES } from "../utils/categories.js";
import { getCityDefaults, getDefaultCity, isSupportedCity, getSupportedCities, resolveCityFromArea, resolveCitiesFromArea, CITY_LEVEL_ALIASES, AREA_CITY_MAP_KEYS } from "../utils/city-defaults.js";
import { formatSpotsForLLM, extractListCount, mapBudgetToPriceRange } from "./query.js";
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
  // If an area is present, we have enough signal to recommend — don't ask for more
  return VAGUE_MEAL_TYPES.has(meal) && !details.mood && !details.area;
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
  const listCount = extractListCount(message);
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather(traveler.current_city);

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
  const hour = (new Date().getUTCHours() + cityDefaults.utcOffset) % 24;
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
  // Parse sub-areas — preserves neighbourhood filters ("Bangsar", "SS2") while
  // discarding city-level aliases ("PJ", "KL") that have already resolved to queryCities.
  const dbAreas = await getDistinctAreas();
  const rawAreas = details.area ? parseAreas(details.area, dbAreas, AREA_CITY_MAP_KEYS) : [];
  const subAreas = rawAreas.filter(a => !CITY_LEVEL_ALIASES.has(a.toLowerCase()));
  const areaList = subAreas.length > 0 ? subAreas : undefined;

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
        areas: areaList,
        categories: DEFAULT_CATEGORIES,
        indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
        exclude_weather_dependent: weather?.is_raining ?? false,
        excludeIds: dislikedIds,
        limit: Math.max(5, listCount),
      });
      // If still empty and area was filtered, retry without area constraint
      if (spots.length === 0 && areaList) {
        areaWidened = true;
        spots = await querySpots({
          city: queryCity,
          cities: queryCities,
          categories: DEFAULT_CATEGORIES,
          indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
          exclude_weather_dependent: weather?.is_raining ?? false,
          excludeIds: dislikedIds,
          limit: Math.max(5, listCount),
        });
      }
    }
  } else {
    // Category query ("dinner", "breakfast") — structured first, semantic fallback
    spots = await querySpots({
      city: queryCity,
      cities: queryCities,
      areas: areaList,
      categories,
      indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
      exclude_weather_dependent: weather?.is_raining ?? false,
      excludeIds: dislikedIds,
      limit: Math.max(5, listCount),
    });
    // If empty and area was filtered, retry without area constraint
    if (spots.length === 0 && areaList) {
      areaWidened = true;
      spots = await querySpots({
        city: queryCity,
        cities: queryCities,
        categories,
        indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
        exclude_weather_dependent: weather?.is_raining ?? false,
        excludeIds: dislikedIds,
        limit: Math.max(5, listCount),
      });
    }
    if (spots.length === 0) {
      spots = await trySemanticSearch(message, resolvedCity ?? cityDefaults.name);
    }
  }

  // Weather × time-of-day: deprioritize outdoor evening spots when raining
  if (weather?.is_raining && spots.length > 1) {
    spots.sort((a, b) => {
      const aRisky = a.indoor_outdoor === "outdoor" && (a.best_time_of_day === "evening" || a.best_time_of_day === "night");
      const bRisky = b.indoor_outdoor === "outdoor" && (b.best_time_of_day === "evening" || b.best_time_of_day === "night");
      return (aRisky ? 1 : 0) - (bRisky ? 1 : 0);
    });
  }

  // Filter out visited spots only for travelers (locals may want to revisit favorites)
  let toRecommend: Spot[];
  if (traveler.user_type !== "local") {
    const unvisited = spots.filter(
      (s) => !traveler.spots_recommended?.includes(s.id)
    );
    toRecommend = unvisited.length > 0 ? unvisited.slice(0, listCount) : spots.slice(0, listCount);
  } else {
    // For locals, filter out disliked spots instead
    const notDisliked = spots.filter(
      (s) => !traveler.spots_disliked?.includes(s.id)
    );
    toRecommend = notDisliked.slice(0, listCount);
  }

  for (const spot of toRecommend) {
    incrementRecommendationCount(spot.id);
  }
  await markSpotsRecommended(phoneNumber, toRecommend.map(s => s.id));
  if (toRecommend.length > 0) {
    trackEvent(phoneNumber, options?.channel ?? "whatsapp", "recommendation", {
      spot_ids: toRecommend.map(s => s.id),
      spot_names: toRecommend.map(s => s.name),
      intent: "hungry",
      area: details.area,
      meal_type: details.meal_type,
      cuisine: details.cuisine,
    });
  }

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
  // subAreas is already computed above from parseAreas — reuse it here.
  const distanceFromArea = new Map<string, string>();
  if (subAreas.length > 0) {
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
    ? `\nDo NOT ask "local or just visiting?" You have already asked this.`
    : !alreadyAskedLocalOrVisiting && isNewUser(traveler)
      ? `\nThis user is new. After giving the recommendation, add one casual line: "Quick one, local or just visiting? Helps me tune what I show you." Only add this if you haven't already asked.`
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

STRICT DATA RULE — do not add information beyond what's in the data:
- The spot data above (Order, Tips, Hours, Price, Payment, Vibe, Setting, Distance) is your verified knowledge — report it confidently.
- Only say "I don't have that detail" when a field is literally absent from the data. If Hours, Payment, or Price ARE in the data, state them directly.
- If Order or Tips are absent for a spot, say "I know this spot but don't have deep intel yet" — but STILL recommend the spot with its name, area, and vibe. Never refuse to include a spot just because intel is thin.
- NEVER mention distance or travel time unless a Distance field is present in the spot data.
- NEVER add sell-out times or operating hours from your training knowledge — only use what's in the data above.

RESPONSE FORMAT — follow exactly:
- Start your response with the spot name. No intro sentence. No "If you want..." opener.
- Line 1: Name (Area)
- Line 2: what to order + one tip (only if data exists)
- Blank line between spots
- Max ${listCount} spots
- Lead with your #1 pick

Example of correct format (no em dashes, ever):
Dewakan (KLCC)
Tasting menu only, book 2 weeks ahead.

Bar.Kar (KLCC)
Open-flame dishes, reserve in advance.

FORMATTING REMINDER: No em dashes (—). Use commas or periods instead. Never: "great coffee — order the latte". Always: "great coffee, order the latte".
Respect dietary restrictions. Don't end with a question unless the query is genuinely too vague to recommend anything.${noRepeatNote}${langUserNote(message)}`,
    spotIds: toRecommend.map(s => s.id),
    maxTokens: Math.max(512, listCount * 80),
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
  const defaultCity = traveler.current_city ?? getDefaultCity();
  // Use forecast for day plans — it gives a better full-day picture than current conditions
  const forecast = await getDayForecast(traveler.current_city);
  const weather = forecast ? {
    is_raining: forecast.will_rain,
    summary: forecast.summary,
  } : await getCurrentWeather(traveler.current_city);

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

  // ── Phase 2a: Time awareness ──────────────────────────────────────
  // Skip meal categories that are no longer relevant at the current local time.
  const cityDefaults = getCityDefaults(traveler.current_city);
  const klHour = (new Date().getUTCHours() + cityDefaults.utcOffset) % 24;
  const skipBreakfast = klHour >= 12 || /\b(already ate|had breakfast|just woke up late|skip breakfast)\b/i.test(message + " " + (conversationHistory ?? ""));
  const skipLunch = klHour >= 15 || /\b(already (had|ate) lunch|skip lunch)\b/i.test(message + " " + (conversationHistory ?? ""));
  const isBrunchRequest = /\bbrunch\b/i.test(message);

  // Time-of-day label for the LLM
  const timeOfDayLabel =
    klHour < 11 ? "morning" :
    klHour < 15 ? "afternoon" :
    klHour < 20 ? "evening" : "late night";

  const timeContextNote = `Current local time: ${klHour}:00 (${timeOfDayLabel}).${skipBreakfast ? " Breakfast has passed — do not suggest breakfast spots." : ""}${skipLunch ? " Lunch has passed — do not suggest lunch spots." : ""}`;

  // ── Phase 2c: Preference integration ────────────────────────────
  const budgetSignal = traveler.preferences?.budget as string | undefined;
  const priceRange = mapBudgetToPriceRange(budgetSignal);

  // Pace signal → vibe hint for LLM (no hard filter — just guidance)
  const pace = traveler.preferences?.pace as string | undefined;
  const paceNote = pace === "chill"
    ? "They prefer a relaxed pace — favour chill, casual vibes and avoid chaotic spots."
    : pace === "fast"
    ? "They want to pack a lot in — skip weather-dependent outdoor spots that might slow things down."
    : "";

  // Interest signal → boost certain categories
  const interests = traveler.preferences?.interests as string[] | undefined ?? [];
  const boostCafe = interests.some(i => /coffee|cafe/i.test(i));
  const boostMarket = interests.some(i => /market|shop/i.test(i));

  // ── Phase 2d: Flexible meal structure ───────────────────────────
  const alreadyAteBreakfast = /\b(already (ate|had) breakfast|just ate|had something)\b/i.test(message);
  const alreadyAteLunch = /\b(already (ate|had) lunch)\b/i.test(message);
  const effectiveSkipBreakfast = skipBreakfast || alreadyAteBreakfast;
  const effectiveSkipLunch = skipLunch || alreadyAteLunch;

  // Detect family/kids context to filter out chaotic/adult vibes and evening-only spots
  const isFamilyContext = /\b(kids?|children|family|toddler|baby|babies|child)\b/i.test(message);
  const vibeExclude = isFamilyContext ? ["chaotic", "nightlife"] : [];
  const timeExclude = isFamilyContext ? ["evening", "late-night"] : [];

  // Build category queries — skip meals already had or past time
  const breakfastCategories = isBrunchRequest ? ["breakfast", "cafe", "lunch"] : ["breakfast", "cafe"];
  const lunchCategories = isBrunchRequest ? [] : ["lunch"]; // brunch merges with breakfast query

  const spotQueries: Promise<Spot[]>[] = [];
  const slotLabels: string[] = [];

  if (!effectiveSkipBreakfast) {
    spotQueries.push(querySpots({ city, cities, categories: breakfastCategories, priceRange, excludeIds: dislikedIds, limit: 3 }));
    slotLabels.push("breakfast");
  }
  if (!effectiveSkipLunch && lunchCategories.length > 0) {
    spotQueries.push(querySpots({ city, cities, categories: lunchCategories, priceRange, excludeIds: dislikedIds, limit: 3 }));
    slotLabels.push("lunch");
  }
  spotQueries.push(querySpots({ city, cities, categories: ["activity", "market"], priceRange, excludeIds: dislikedIds, limit: 3 }));
  slotLabels.push("activities");
  spotQueries.push(querySpots({ city, cities, categories: ["dinner"], priceRange, excludeIds: dislikedIds, limit: 3 }));
  slotLabels.push("dinner");
  if (boostCafe) {
    spotQueries.push(querySpots({ city, cities, categories: ["cafe"], priceRange, excludeIds: dislikedIds, limit: 2 }));
    slotLabels.push("cafe");
  }
  if (boostMarket) {
    spotQueries.push(querySpots({ city, cities, categories: ["market"], priceRange, excludeIds: dislikedIds, limit: 2 }));
    slotLabels.push("market");
  }

  const slotResults = await Promise.all(spotQueries);

  // Filter out family-unfriendly vibes and evening-only spots for family context
  const filterFamilyVibes = (spots: Spot[]) =>
    isFamilyContext
      ? spots.filter(s => !vibeExclude.includes(s.vibe ?? "") && !timeExclude.includes(s.best_time_of_day ?? ""))
      : spots;

  // ── Phase 2b: Geographic clustering ─────────────────────────────
  // If the user specified an area, prefer spots within 3km of its centroid.
  const requestedArea = details.area;
  let areaCentroid: { lat: number; lng: number } | undefined;
  if (requestedArea) {
    areaCentroid = await getAreaCentroid(requestedArea).catch(() => undefined);
  }

  const clusterSpots = (spots: Spot[]): Spot[] => {
    if (!areaCentroid) return spots;
    // Separate into "nearby" (<3km) and "elsewhere"
    const nearby = spots.filter(s =>
      s.latitude != null && s.longitude != null &&
      haversineKm(areaCentroid!.lat, areaCentroid!.lng, s.latitude!, s.longitude!) <= 3
    );
    const elsewhere = spots.filter(s => !nearby.includes(s));
    // Prefer nearby spots — append elsewhere as fallback
    return [...nearby, ...elsewhere];
  };

  const allDaySpots: Spot[] = [];
  for (const rawSlot of slotResults) {
    const filtered = filterFamilyVibes(rawSlot);
    const clustered = clusterSpots(filtered);
    allDaySpots.push(...clustered);
  }

  // De-duplicate by id (cafe boost may overlap with activity slots)
  const seenIds = new Set<string>();
  const dedupedSpots = allDaySpots.filter(s => {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    return true;
  });

  const familyNote = isFamilyContext
    ? "\nThis is a family day with kids — only include spots that are child-friendly. No chaotic hawker markets, loud spots, or adult-only venues."
    : "";
  const spotsContext = formatSpotsForLLM(dedupedSpots);

  // Build geographic cluster hint for LLM
  const areaClusterNote = areaCentroid && requestedArea
    ? `Geographic focus: spots near ${requestedArea} are listed first. Where possible, suggest a logical flow through nearby spots before venturing further.`
    : "";

  // Mark all recommended spots
  await markSpotsRecommended(phoneNumber, dedupedSpots.map(s => s.id));
  if (dedupedSpots.length > 0) {
    trackEvent(phoneNumber, options?.channel ?? "whatsapp", "recommendation", {
      spot_ids: dedupedSpots.map(s => s.id),
      spot_names: dedupedSpots.map(s => s.name),
      intent: "day_plan",
      area: details.area,
    });
  }

  const prefContext = buildPrefContext(traveler);

  // Use the resolved city name (first from cities, or defaultCity) for the system prompt
  const systemCity = (cities?.[0]) ?? defaultCity;

  // ── Phase 4b: Happenings — what's on today ──────────────────────
  const happenings = await queryHappenings(systemCity).catch(() => [] as Happening[]);
  const happeningsContext = happenings.length > 0
    ? happenings.map(h => {
        const lines = [`Event: ${h.name}`];
        if (h.area) lines.push(`  Area: ${h.area}`);
        if (h.description) lines.push(`  Info: ${h.description}`);
        if (h.recurring && h.recurrence_rule) lines.push(`  Recurring: ${h.recurrence_rule}`);
        if (h.categories?.length) lines.push(`  Type: ${h.categories.join(", ")}`);
        return lines.join("\n");
      }).join("\n\n")
    : "";

  return {
    systemPrompt: buildSystemPrompt(systemCity, channel) + langInstruction(message),
    userPrompt: `The user asks: "${message}"
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
${forecast ? `Weather today: ${forecast.summary} Best outdoor window: ${forecast.best_window}.` : weather ? `Weather: ${weather.summary}` : ""}
${timeContextNote}
${details.area ? `Area focus: ${details.area}` : ""}
${details.mood ? `Their energy/mood: ${details.mood}` : ""}
${paceNote}
${prefContext}
${areaClusterNote}
Spots they've already seen: ${traveler.spots_recommended?.length ?? 0}

${happeningsContext ? `What's on today:\n\n${happeningsContext}\n\nIf any event fits the day plan (a market, festival, or neighbourhood event), weave it in naturally. These are current events — not spots in your knowledge graph.\n` : ""}
Available spots for building a day plan:

${spotsContext}

${familyNote}
If the user is specifically asking about non-food activities (things to do, sightseeing, etc.), be honest that your strength is food and dining. You can mention any activity spots you have, but flag that you don't have full activities coverage and they should check elsewhere for that.

STRICT DATA RULE: Only mention details explicitly listed for each spot in the data above (Order, Tips, Hours, Price, Vibe). If a spot has no Order or Tips data, say "I know this place but don't have deep intel" — never invent dishes, hours, prices, or travel times. Never estimate how long it takes to get from one spot to another.

Build a loose, conversational day structure — "here's a nice flow for today." Only mention spots from the data above — never invent activities, attractions, or places not in your knowledge. Respect dietary restrictions. End with something casual like "text me when you're hungry or want to switch things up."

FORMAT OVERRIDE FOR DAY PLAN: This is a day itinerary. The 3-spot system rule DOES NOT apply here.
- For "eat all day", "food tour", or food-focused day requests: include breakfast/morning, lunch, afternoon, and dinner — 4 stops minimum across the full day. Do not give only 3 stops.
- For multi-day requests (2-day, 3-day): structure by day with at least 2-3 meals per day.
- For culture + food: when the user says "cultural", they mean museums, temples, galleries, or heritage areas (Batu Caves, Thean Hou Temple, Ilham Gallery, Kampung Baru walking tour) — NOT markets or hawker centers. Lead with the cultural venue first, then food stops.
- For family/kids: only include child-friendly spots (check the Vibe field — avoid "chaotic").
Format: Name (Area) on line 1, what to order + one tip on line 2. Blank line between stops.${langUserNote(message)}`,
    spotIds: dedupedSpots.map(s => s.id),
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
  const city = traveler.current_city ?? getDefaultCity();
  const weather = await getCurrentWeather(traveler.current_city);

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

  // Build distance labels using area centroid for text-based area search
  const distanceFromArea = new Map<string, string>();
  if (!coords && area) {
    const areaCentroid = await getAreaCentroid(area);
    if (areaCentroid) {
      for (const spot of spots) {
        if (spot.latitude != null && spot.longitude != null) {
          const km = haversineKm(areaCentroid.lat, areaCentroid.lng, spot.latitude, spot.longitude);
          const label = km < 1
            ? `~${Math.round(km * 1000)}m from ${area}`
            : `~${km.toFixed(1)}km from ${area}`;
          distanceFromArea.set(spot.id, label);
        }
      }
    }
  }

  const spotsContext = formatSpotsForLLM(spots, distanceFromArea);

  // Track usage and mark as recommended
  for (const spot of spots) {
    incrementRecommendationCount(spot.id);
  }
  await markSpotsRecommended(phoneNumber, spots.map(s => s.id));
  if (spots.length > 0) {
    trackEvent(phoneNumber, options?.channel ?? "whatsapp", "recommendation", {
      spot_ids: spots.map(s => s.id),
      spot_names: spots.map(s => s.name),
      intent: "nearby",
      area: area ?? (coords ? `${coords.lat},${coords.lng}` : undefined),
    });
  }

  const prefContext = buildPrefContext(traveler);

  return {
    systemPrompt: buildSystemPrompt(city, channel) + langInstruction(message),
    userPrompt: `The user says: "${message}"
${conversationHistory ? `\nRecent conversation:\n${conversationHistory}\n` : ""}
${weather ? `Weather: ${weather.summary}` : ""}
${area ? `They're near: ${area}` : coords ? `They shared coordinates: ${coords.lat}, ${coords.lng}` : ""}
${prefContext}

STRICT DATA RULES — these override everything else:
- ONLY state details found in labeled fields (Order, Tips, Hours, Price, Payment, Distance, Address) in the knowledge graph below.
- NEVER state addresses, awards, accolades, prices, or hours unless they appear as a labeled field in the spot data.
- NEVER cross-attribute: a detail from one spot must not be stated about a different spot.
${distanceContext ? "- Include the approximate distance for each spot (use the Distances list)." : distanceFromArea.size > 0 ? "- Mention the Distance field value when present to confirm proximity." : "- Do NOT estimate walking times or distances — no GPS data available."}

Nearby spots from knowledge graph:
${distanceContext ? `\nDistance reference:\n${distanceContext}` : ""}
${spotsContext}

Give them a focused list of what's nearby. Respect dietary restrictions.${langUserNote(message)}`,
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

/** Format a spot's DB record into a data block string for LLM prompts */
function buildSpotDataBlock(spot: Spot): string {
  return [
    spot.name && `Name: ${spot.name}`,
    spot.area && `Area: ${spot.area}`,
    (spot as any).address && `Address: ${(spot as any).address}`,
    (spot as any).categories?.length && `Category: ${(spot as any).categories.join(", ")}`,
    spot.price_range && `Price: ${spot.price_range}`,
    spot.payment_methods?.length && `Payment: ${spot.payment_methods.join(", ")}`,
    spot.opening_hours && `Hours: ${JSON.stringify(spot.opening_hours)}`,
    spot.what_to_order?.length && `Order: ${spot.what_to_order.join(", ")}`,
    spot.what_to_skip?.length && `Skip: ${spot.what_to_skip.join(", ")}`,
    spot.pro_tips?.length && `Tips: ${spot.pro_tips.join(" | ")}`,
    spot.vibe && `Vibe: ${spot.vibe}`,
    spot.indoor_outdoor && `Setting: ${spot.indoor_outdoor}`,
    spot.best_time_of_day && `Best time: ${spot.best_time_of_day}`,
  ].filter(Boolean).join("\n");
}

/**
 * Build the spot info prompt payload — DB lookup + optional web enrichment.
 * Returns PromptPayload so the web route can emit spotIds for eval ground truth.
 */
export async function buildSpotInfoPayload(
  _phoneNumber: string,
  userMessage: string,
  spotName: string,
  city: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<PromptPayload> {
  const systemPrompt = buildSystemPrompt(city, options?.channel);

  // Step 1: detect comparison queries ("Bijan or Sao Nam", "X vs Y")
  // The intent classifier may lump both names into one spot_name string.
  const comparisonMatch = spotName.match(/^(.+?)\s+(?:or|vs\.?)\s+(.+?)(?:\s+for\s+|$)/i);
  if (comparisonMatch) {
    const [, nameA, nameB] = comparisonMatch;
    const [spotA, spotB] = await Promise.all([
      findSpotByName(nameA.trim(), city),
      findSpotByName(nameB.trim(), city),
    ]);
    if (spotA || spotB) {
      const blocks: string[] = [];
      if (spotA) {
        const aBlock = buildSpotDataBlock(spotA);
        blocks.push(`=== ${spotA.name} ===\n${aBlock}`);
      } else {
        blocks.push(`=== ${nameA.trim()} ===\n(Not in knowledge graph — no intel yet)`);
      }
      if (spotB) {
        const bBlock = buildSpotDataBlock(spotB);
        blocks.push(`=== ${spotB.name} ===\n${bBlock}`);
      } else {
        blocks.push(`=== ${nameB.trim()} ===\n(Not in knowledge graph — no intel yet)`);
      }
      return {
        systemPrompt,
        userPrompt: `Spot data for comparison:\n\n${blocks.join("\n\n")}\n\nUser question: ${userMessage}\n\nGive an opinionated comparison. Answer directly with your pick and why. 3-4 sentences. Only reference facts from the data above.`,
        spotIds: [spotA?.id, spotB?.id].filter(Boolean) as string[],
        maxTokens: 300,
      };
    }
  }

  // Step 2: fetch DB record first
  const dbSpot = await findSpotByName(spotName, city);

  // No DB record — don't answer from web data alone (hallucination risk).
  if (!dbSpot) {
    return {
      systemPrompt,
      userPrompt: `User asked: "${userMessage}". You have no record of "${spotName}" in your knowledge graph. Be honest that you don't have intel on it yet, then offer to show what you do know in ${city} — ask if there's a specific area or type of food they want. Two sentences max.`,
      spotIds: [],
      maxTokens: 150,
    };
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
    merged.opening_hours && `Hours: ${JSON.stringify(merged.opening_hours)}`,
    merged.what_to_order?.length && `Order: ${(merged.what_to_order as string[]).join(", ")}`,
    merged.what_to_skip?.length && `Skip: ${(merged.what_to_skip as string[]).join(", ")}`,
    merged.pro_tips?.length && `Tips: ${(merged.pro_tips as string[]).join(" | ")}`,
    merged.vibe && `Vibe: ${merged.vibe}`,
    merged.indoor_outdoor && `Setting: ${merged.indoor_outdoor}`,
    merged.best_time_of_day && `Best time: ${merged.best_time_of_day}`,
  ].filter(Boolean).join("\n");

  return {
    systemPrompt,
    userPrompt: `Spot data:\n${dataBlock}\n\nUser question: ${userMessage}\n\nAnswer the user's question using ONLY the spot data above. Be specific and direct. 2-3 sentences max.${hoursFromWeb ? "\nMANDATORY: Hours above came from live web search, not contributor-verified data. You MUST include a caveat like 'worth confirming before you go' or 'check before heading out'." : ""}`,
    spotIds: [dbSpot.id],
    maxTokens: 200,
  };
}

/**
 * Spot info handler — answers specific questions about a named place.
 * DB record + optional web enrichment. Always has something to say.
 */
export async function handleSpotInfo(
  phoneNumber: string,
  userMessage: string,
  spotName: string,
  city: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const payload = await buildSpotInfoPayload(phoneNumber, userMessage, spotName, city, options);
  return chat(
    payload.systemPrompt,
    [{ role: "user", content: payload.userPrompt }],
    { maxTokens: payload.maxTokens }
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
